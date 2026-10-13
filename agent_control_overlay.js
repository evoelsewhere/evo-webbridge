/**
 * EvoFlux agent-control overlay.
 *
 * Injected on demand into the top frame while WebBridge owns the tab. The
 * closed-over state is intentionally page-local: navigation removes it, and
 * the service worker restores it only when the debugger is still attached.
 */
(() => {
  if (globalThis.__evofluxAgentControlOverlay) return;

  const HOST_ID = "__evoflux-agent-control-overlay";
  // Arrow tip (4, 2.7 of the 24×27 viewBox) inside the 14.22×16 cursor box.
  const TIP_X = 2.37;
  const TIP_Y = 1.6;
  let host = null;
  let cursor = null;
  let cursorPulse = null;
  let enabled = false;
  let suspended = false;
  let lastX = null;
  let lastY = null;
  let pulseTimer = null;

  function promoteOverlay() {
    if (!host || typeof host.showPopover !== "function") return;
    if (host.matches(":popover-open")) host.hidePopover();
    host.showPopover();
  }

  function mount() {
    if (host?.isConnected) return;
    host = document.getElementById(HOST_ID);
    if (host) {
      cursor = host.shadowRoot?.querySelector(".cursor") || null;
      cursorPulse = host.shadowRoot?.querySelector(".cursor-pulse") || null;
      promoteOverlay();
      return;
    }

    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("popover", "manual");
    host.style.cssText = "all:initial;position:fixed;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;contain:layout style;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .layer { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
        .frame {
          position: absolute; inset: 0;
          border: 2px solid rgba(121, 247, 255, .92);
          box-shadow:
            inset 0 0 12px rgba(0, 238, 255, .95),
            inset 0 0 34px rgba(45, 205, 224, .24),
            inset 0 0 70px rgba(0, 224, 255, .18);
          animation: evoflux-frame-bloom 1.8s ease-in-out infinite;
        }
        .frame::after {
          content: ""; position: absolute; inset: 0;
          border: 1px solid rgba(198, 255, 255, .7);
          box-shadow: inset 0 0 18px rgba(82, 247, 255, .42);
          animation: evoflux-frame-wave 1.8s ease-out infinite;
        }
        .cursor {
          position: absolute; left: 0; top: 0; width: 14.22px; height: 16px;
          transform: translate3d(var(--cursor-x, 72vw), var(--cursor-y, 34vh), 0);
          transform-origin: 2.37px 1.6px;
          transition: transform var(--cursor-duration, 28ms) cubic-bezier(.22,1,.36,1);
          will-change: transform;
        }
        .cursor-aura {
          position: absolute; left: -4.5px; top: -4.5px; width: 15px; height: 15px;
          border-radius: 50%; opacity: .46;
          background: radial-gradient(circle, rgba(255,255,255,.34) 0 8%, rgba(119,92,255,.24) 32%, rgba(67,210,255,.11) 54%, transparent 74%);
          filter: blur(2px);
        }
        .cursor svg {
          position: relative; display: block; width: 100%; height: 100%; overflow: visible;
          filter: drop-shadow(0 1px 1px rgba(0,0,0,.5)) drop-shadow(0 0 3px rgba(126,93,255,.58)) drop-shadow(0 0 5px rgba(67,210,255,.22));
        }
        .cursor-glow { fill: none; stroke: rgba(123,91,255,.68); stroke-width: 5.5; stroke-linejoin: round; stroke-linecap: round; opacity: .42; filter: blur(1.5px); }
        .cursor-outline { fill: none; stroke: rgba(255,255,255,.99); stroke-width: 3.8; stroke-linejoin: round; stroke-linecap: round; }
        .cursor-core { fill: url(#evoflux-cursor-fill); stroke: #030407; stroke-width: .9; stroke-linejoin: round; stroke-linecap: round; }
        .cursor-pulse {
          position: absolute; left: -3px; top: -3px; width: 10px; height: 10px;
          border: 1.5px solid rgba(126,102,255,.86); box-shadow: 0 0 8px rgba(70,211,255,.72); border-radius: 50%; opacity: 0; transform: scale(.25);
        }
        .cursor.pressed { transform: translate3d(var(--cursor-x), var(--cursor-y), 0) scale(.9); }
        .cursor.pressed .cursor-aura { opacity: .78; filter: blur(2px); }
        .cursor.pulsing .cursor-pulse { animation: evoflux-click .42s ease-out; }
        @keyframes evoflux-frame-bloom {
          0%, 100% { opacity: .68; }
          50% { opacity: 1; }
        }
        @keyframes evoflux-frame-wave {
          0% { opacity: .8; box-shadow: inset 0 0 8px rgba(82, 247, 255, .48); }
          70%, 100% { opacity: .12; box-shadow: inset 0 0 54px rgba(82, 247, 255, .08); }
        }
        @keyframes evoflux-click { 0% { opacity: 1; transform: scale(.25); } 100% { opacity: 0; transform: scale(2.2); } }
        @media (prefers-reduced-motion: reduce) {
          .frame, .frame::after { animation: none; }
          .cursor { transition-duration: 0ms; }
        }
      </style>
      <div class="layer">
        <div class="frame"></div>
        <div class="cursor">
          <span class="cursor-aura"></span>
          <span class="cursor-pulse"></span>
          <svg viewBox="0 0 24 27" aria-hidden="true">
            <defs>
              <linearGradient id="evoflux-cursor-fill" x1="5" y1="2" x2="15" y2="24" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#111319"/>
                <stop offset=".58" stop-color="#050609"/>
                <stop offset="1" stop-color="#010102"/>
              </linearGradient>
            </defs>
            <path class="cursor-glow" d="M4 2.7v18.5c0 2.6 3.2 3.8 4.9 1.8l4.35-5.2h5.95c2.55 0 3.7-3.2 1.75-4.82L7.75 1.35C6.25.1 4 1.17 4 2.7Z"/>
            <path class="cursor-outline" d="M4 2.7v18.5c0 2.6 3.2 3.8 4.9 1.8l4.35-5.2h5.95c2.55 0 3.7-3.2 1.75-4.82L7.75 1.35C6.25.1 4 1.17 4 2.7Z"/>
            <path class="cursor-core" d="M4 2.7v18.5c0 2.6 3.2 3.8 4.9 1.8l4.35-5.2h5.95c2.55 0 3.7-3.2 1.75-4.82L7.75 1.35C6.25.1 4 1.17 4 2.7Z"/>
          </svg>
        </div>
      </div>`;
    cursor = root.querySelector(".cursor");
    cursorPulse = root.querySelector(".cursor-pulse");
    if (lastX == null || lastY == null) {
      lastX = Math.max(0, Math.min(innerWidth - 1, innerWidth * 0.72));
      lastY = Math.max(0, Math.min(innerHeight - 1, innerHeight * 0.34));
    }
    cursor.style.setProperty("--cursor-x", `${lastX - TIP_X}px`);
    cursor.style.setProperty("--cursor-y", `${lastY - TIP_Y}px`);
    (document.documentElement || document).appendChild(host);
    promoteOverlay();
    host.style.visibility = suspended ? "hidden" : "visible";
  }

  function unmount() {
    clearTimeout(pulseTimer);
    pulseTimer = null;
    host?.remove();
    host = null;
    cursor = null;
    cursorPulse = null;
  }

  function movePointer(x, y, phase = "move", motion = "human") {
    if (!cursor || !Number.isFinite(x) || !Number.isFinite(y)) return;
    promoteOverlay();
    const distance = lastX == null || lastY == null ? 0 : Math.hypot(x - lastX, y - lastY);
    if (distance >= 1) {
      const duration = motion === "instant"
        ? Math.max(28, Math.min(220, Math.round(distance * 0.7)))
        : 28;
      cursor.style.setProperty("--cursor-duration", `${duration}ms`);
    }
    lastX = Math.max(0, Math.min(innerWidth - 1, x));
    lastY = Math.max(0, Math.min(innerHeight - 1, y));
    // The SVG pointer tip is at (4, 2.7); offset the visual so its tip is the
    // exact CSS-pixel coordinate sent to CDP.
    cursor.style.setProperty("--cursor-x", `${lastX - TIP_X}px`);
    cursor.style.setProperty("--cursor-y", `${lastY - TIP_Y}px`);
    cursor.classList.toggle("pressed", phase === "press" || phase === "drag");
    if (phase !== "release" && phase !== "click") return;
    cursor.classList.remove("pressed");
    cursor.classList.remove("pulsing");
    void cursorPulse?.offsetWidth;
    cursor.classList.add("pulsing");
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => cursor?.classList.remove("pulsing"), 460);
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      unmount();
      return;
    }
    mount();
    if (lastX != null && lastY != null) movePointer(lastX, lastY);
  }

  function setSuspended(nextSuspended) {
    suspended = Boolean(nextSuspended);
    if (!host) return;
    host.style.visibility = suspended ? "hidden" : "visible";
    // Force style resolution before acknowledging a capture suspension so the
    // following CDP screenshot command cannot reuse the previous visible frame.
    void host.offsetHeight;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "webbridge_agent_control") return;
    if (typeof message.enabled === "boolean") setEnabled(message.enabled);
    if (typeof message.suspended === "boolean") setSuspended(message.suspended);
    if (enabled && message.pointer) {
      movePointer(
        Number(message.pointer.x),
        Number(message.pointer.y),
        message.pointer.phase,
        message.pointer.motion,
      );
    }
    sendResponse({
      ok: true,
      enabled,
      suspended,
      pointer: lastX == null || lastY == null ? null : { x: lastX, y: lastY },
    });
  });

  globalThis.__evofluxAgentControlOverlay = { setEnabled, setSuspended, movePointer };
})();
