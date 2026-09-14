/**
 * The page-side half of WebBridge.
 *
 * Everything here runs inside the page the agent is driving, injected once
 * per document by the service worker. It exists for three reasons the old
 * one-off `Runtime.evaluate` strings could not serve:
 *
 *  - **Handles.** A snapshot used to hand back a CSS path per element, which
 *    the model then had to quote back at us: long to read, longer to write,
 *    and wrong as soon as the page re-rendered. Elements now keep a short
 *    id (`e12`) for as long as the document lives, so a snapshot is cheap to
 *    read and acting on one is an exact lookup rather than a fresh query.
 *
 *  - **Reach.** `document.querySelectorAll` stops at a shadow boundary and
 *    never enters an iframe, so a page built out of web components looked
 *    empty and the only way left to drive it was screenshots and
 *    coordinates. The walk below goes through open shadow roots and
 *    same-origin frames, carrying each frame's offset so coordinates stay
 *    in the top document's space — the space CDP input events land in.
 *
 *  - **Actionability.** Dispatching a press at a point says nothing about
 *    what is *at* that point. A cookie banner over the button used to
 *    swallow the click and report success. Every target is now hit-tested
 *    first, and says what covered it when it fails.
 */

(() => {
  const VERSION = 3;
  if (globalThis.__evoflux && globalThis.__evoflux.v === VERSION) return "ready";

  const INTERACTIVE = [
    "a[href]", "area[href]", "button", "input:not([type=hidden])", "select",
    "textarea", "summary", "[role=button]", "[role=link]", "[role=tab]",
    "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]",
    "[role=checkbox]", "[role=radio]", "[role=switch]", "[role=combobox]",
    "[role=listbox]", "[role=option]", "[role=slider]", "[role=spinbutton]",
    "[role=textbox]", "[role=searchbox]", "[role=treeitem]",
    "[contenteditable=true]", "[tabindex]:not([tabindex='-1'])", "[onclick]",
  ].join(",");

  const norm = (value) => String(value || "").replace(/\s+/g, " ").trim();

  // ── Handles ────────────────────────────────────────────────────────────
  // An element keeps the same id for as long as this document lives, which
  // is what lets one snapshot be compared with the next. WeakRef both ways
  // so a page that churns nodes does not leak them through this table.
  const refs = { next: 1, byEl: new WeakMap(), byId: new Map() };

  function refFor(el) {
    let id = refs.byEl.get(el);
    if (!id) {
      id = "e" + refs.next++;
      refs.byEl.set(el, id);
    }
    refs.byId.set(id, new WeakRef(el));
    return id;
  }

  function resolve(id) {
    const held = refs.byId.get(String(id || ""));
    const el = held && held.deref();
    if (!el) return null;
    // Detached nodes answer no questions worth trusting.
    return el.isConnected ? el : null;
  }

  // ── Describing an element ──────────────────────────────────────────────
  function inferredRole(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a" || tag === "area") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "textarea" || el.isContentEditable) return "textbox";
    if (tag === "select") return el.multiple ? "listbox" : "combobox";
    if (tag !== "input") return tag;
    return ({
      button: "button", submit: "button", reset: "button", image: "button",
      checkbox: "checkbox", radio: "radio", range: "slider",
      number: "spinbutton", search: "searchbox",
    })[el.type] || "textbox";
  }

  function accessibleName(el) {
    const aria = norm(el.getAttribute("aria-label"));
    if (aria) return aria;
    const labelledBy = norm(el.getAttribute("aria-labelledby"));
    if (labelledBy) {
      const root = el.getRootNode();
      const value = norm(labelledBy.split(/\s+/)
        .map((id) => (root.getElementById ? root.getElementById(id) : null)?.textContent)
        .join(" "));
      if (value) return value;
    }
    const labels = el.labels
      ? norm([...el.labels].map((l) => l.innerText || l.textContent).join(" "))
      : "";
    if (labels) return labels;
    return norm(
      el.getAttribute("alt") || el.getAttribute("title")
      || el.getAttribute("placeholder") || el.innerText
      || ((el.type === "button" || el.type === "submit") ? el.value : ""),
    );
  }

  function controlState(el) {
    const state = {};
    if ("disabled" in el || el.hasAttribute("aria-disabled")) {
      const value = Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true";
      if (value) state.disabled = true;
    }
    if ("checked" in el || el.hasAttribute("aria-checked")) {
      const aria = el.getAttribute("aria-checked");
      state.checked = aria === "mixed" ? "mixed" : (aria ? aria === "true" : Boolean(el.checked));
    }
    if ("selected" in el || el.hasAttribute("aria-selected")) {
      const aria = el.getAttribute("aria-selected");
      state.selected = aria ? aria === "true" : Boolean(el.selected);
    }
    for (const key of ["expanded", "pressed"]) {
      const value = el.getAttribute("aria-" + key);
      if (value != null) state[key] = value === "mixed" ? "mixed" : value === "true";
    }
    if (el.required || el.getAttribute("aria-required") === "true") state.required = true;
    if ("readOnly" in el && el.readOnly) state.readonly = true;
    return state;
  }

  /** A CSS path, but only when there is one that would actually work.
   *
   * An element inside a shadow root or a frame cannot be reached by
   * `document.querySelector`, so offering a path for it would be a lie the
   * model only discovers after spending an action on it. Those elements are
   * addressed by ref, which works everywhere. */
  function cssPath(el) {
    if (el.getRootNode() !== document) return "";
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      let sel = node.tagName.toLowerCase();
      if (node.id) { parts.unshift("#" + CSS.escape(node.id)); break; }
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) sel += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function visible(el) {
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  function describe(el, offsetX, offsetY) {
    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2 + offsetX);
    const y = Math.round(rect.top + rect.height / 2 + offsetY);
    const isPassword = el instanceof HTMLInputElement && el.type === "password";
    const text = norm(el.innerText || (isPassword ? "" : el.value)).slice(0, 120);
    const attributes = {};
    if (el.type) attributes.type = el.type;
    if (el.href) attributes.href = el.href;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) attributes.placeholder = placeholder;
    const item = {
      ref: refFor(el),
      role: inferredRole(el),
      text,
      selector: cssPath(el),
      state: controlState(el),
      attributes,
      box: { x, y, w: Math.round(rect.width), h: Math.round(rect.height) },
    };
    const name = accessibleName(el).slice(0, 120);
    // Only worth its bytes when it says something the text does not.
    if (name && name !== text) item.name = name;
    // Coordinates outside the window are not clickable coordinates. Saying
    // so stops a model reading them off a snapshot and clicking nothing.
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) item.offscreen = true;
    return item;
  }

  // ── The walk ───────────────────────────────────────────────────────────
  function collectFrom(root, offsetX, offsetY, out, max, depth) {
    if (out.length >= max || depth > 12) return;
    let all;
    try {
      all = root.querySelectorAll("*");
    } catch {
      return;
    }
    for (const el of all) {
      if (out.length >= max) return;
      try {
        if (el.matches && el.matches(INTERACTIVE)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && visible(el)) {
            out.push(describe(el, offsetX, offsetY));
          }
        }
        // Open shadow roots hold the whole UI of a web-component page.
        if (el.shadowRoot) {
          collectFrom(el.shadowRoot, offsetX, offsetY, out, max, depth + 1);
        }
        if (el.tagName === "IFRAME") {
          const rect = el.getBoundingClientRect();
          let doc = null;
          try {
            doc = el.contentDocument;  // same-origin only; throws otherwise
          } catch {
            doc = null;
          }
          if (doc) {
            collectFrom(doc, offsetX + rect.left, offsetY + rect.top, out, max, depth + 1);
          } else if (rect.width > 8 && rect.height > 8) {
            // A frame this document may not read. Say it is there rather
            // than let the model conclude the area is empty.
            out.push({
              ref: refFor(el),
              role: "iframe",
              text: "",
              selector: cssPath(el),
              state: {},
              attributes: { src: el.getAttribute("src") || "" },
              cross_origin: true,
              box: {
                x: Math.round(rect.left + rect.width / 2 + offsetX),
                y: Math.round(rect.top + rect.height / 2 + offsetY),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              },
            });
          }
        }
      } catch {
        // One hostile element must not end the walk.
      }
    }
  }

  // ── Snapshots and what changed between them ────────────────────────────
  function fingerprint(item) {
    return [
      item.role,
      item.text,
      item.name || "",
      JSON.stringify(item.state),
      item.offscreen ? 1 : 0,
      // Bucketed: a two-pixel shift is not a change worth a line.
      Math.round(item.box.x / 16),
      Math.round(item.box.y / 16),
    ].join("");
  }

  let lastPrints = null;

  function snapshot(options) {
    const max = Math.max(1, Math.min(300, Number(options && options.max) || 80));
    const out = [];
    collectFrom(document, 0, 0, out, max, 0);
    const prints = new Map(out.map((item) => [item.ref, fingerprint(item)]));
    const base = {
      url: location.href,
      title: document.title,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scrollX: Math.round(scrollX),
        scrollY: Math.round(scrollY),
      },
    };

    if (options && options.diff && lastPrints) {
      const added = [];
      const changed = [];
      let unchanged = 0;
      for (const item of out) {
        const before = lastPrints.get(item.ref);
        if (before === undefined) added.push(item);
        else if (before !== prints.get(item.ref)) changed.push(item);
        else unchanged++;
      }
      const removed = [...lastPrints.keys()].filter((ref) => !prints.has(ref));
      lastPrints = prints;
      return { ...base, diff: true, added, changed, removed, unchanged };
    }

    lastPrints = prints;
    return { ...base, elements: out };
  }

  // ── Acting on a target ─────────────────────────────────────────────────
  function fromSpec(spec) {
    if (!spec) return null;
    if (spec.ref) return resolve(spec.ref);
    if (spec.selector) {
      const index = Math.max(0, Number(spec.index) || 0);
      return document.querySelectorAll(spec.selector)[index] || null;
    }
    return null;
  }

  /** Where an element is, after making sure it is somewhere at all. */
  function frameOffset(el) {
    let offsetX = 0;
    let offsetY = 0;
    let win = el.ownerDocument.defaultView;
    while (win && win !== window && win.frameElement) {
      const rect = win.frameElement.getBoundingClientRect();
      offsetX += rect.left;
      offsetY += rect.top;
      win = win.parent;
    }
    return { offsetX, offsetY };
  }

  function briefly(el) {
    if (!el) return "nothing";
    const tag = el.tagName ? el.tagName.toLowerCase() : "node";
    const cls = el.classList && el.classList.length
      ? "." + [...el.classList].slice(0, 2).join(".")
      : "";
    const label = norm(el.innerText).slice(0, 40);
    return tag + cls + (label ? ` "${label}"` : "");
  }

  /**
   * Bring a target into view and report the point to hit it at.
   *
   * The caller dispatches the real input event: a click has to come from
   * the browser's own input pipeline, not from `el.click()`, or the page
   * sees an event no user could have produced.
   */
  function prepare(spec) {
    const el = fromSpec(spec);
    if (!el) {
      return {
        ok: false,
        reason: spec && spec.ref
          ? `No element for ref ${spec.ref}. The page may have replaced it — take a snapshot.`
          : `No element for selector ${spec && spec.selector}`,
      };
    }
    if (el.disabled || el.getAttribute("aria-disabled") === "true") {
      return { ok: false, reason: `${briefly(el)} is disabled`, ref: refFor(el) };
    }
    el.scrollIntoView({ block: "center", inline: "center" });
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return { ok: false, reason: `${briefly(el)} has no size (hidden?)`, ref: refFor(el) };
    }
    const { offsetX, offsetY } = frameOffset(el);
    const localX = rect.left + rect.width / 2;
    const localY = rect.top + rect.height / 2;
    const root = el.getRootNode();
    let covering = null;
    if (root.elementFromPoint) {
      const top = root.elementFromPoint(localX, localY);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) covering = top;
    }
    return {
      ok: !covering,
      ref: refFor(el),
      x: Math.round(localX + offsetX),
      y: Math.round(localY + offsetY),
      role: inferredRole(el),
      name: accessibleName(el).slice(0, 60) || norm(el.innerText).slice(0, 60),
      value: "value" in el ? String(el.value ?? "").slice(0, 120) : undefined,
      reason: covering
        ? `${briefly(el)} is covered by ${briefly(covering)} — dismiss it, or scroll, then retry`
        : undefined,
    };
  }

  // ── What an action did ─────────────────────────────────────────────────
  // A click's whole purpose is to change something. Reporting *that* is
  // what lets the caller skip the snapshot it would otherwise take just to
  // find out whether anything happened.
  const watch = { mutations: 0, url: location.href };
  try {
    new MutationObserver((records) => { watch.mutations += records.length; })
      .observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, characterData: true,
      });
  } catch {
    // A document without a documentElement yet: the counter stays at zero.
  }

  function since(mark) {
    const mutations = watch.mutations - (Number(mark && mark.mutations) || 0);
    const before = mark && mark.url;
    return {
      mutations,
      url: location.href,
      navigated: Boolean(before && before !== location.href),
      title: document.title,
    };
  }

  function mark() {
    return { mutations: watch.mutations, url: location.href };
  }

  globalThis.__evoflux = {
    v: VERSION,
    snapshot,
    resolve,
    prepare,
    mark,
    since,
    // The lookup every in-page command shares, so `ref` works for all of
    // them and not only the ones that dispatch input events.
    element: fromSpec,
    ref: refFor,
    describe: (el) => describe(el, 0, 0),
  };
  return "ready";
})();
