# Chrome Web Store privacy declarations

Use these statements in the **Privacy practices** tab. They describe version
2.10.0 and later. The package does not expose a relay command for arbitrary page
script evaluation and does not request the unused `activeTab` permission.

## Single purpose

```text
EvoFlux WebBridge has one purpose: connect the user's Chrome browser to their locally running EvoFlux Desktop application so the user can authorize an EvoFlux agent to read and interact with browser tabs. It provides supervised navigation, page reading, screenshots, form interaction, tab management, Side Chat, and explicit controls to pause, resume, or release browser automation. The extension does not operate independently of EvoFlux Desktop.
```

## Remote code

```text
EvoFlux WebBridge does not use remotely hosted code. All JavaScript and executable automation routines are included in the submitted extension package. importScripts loads only semantic_runtime.js bundled with the extension, and the page runtime is fetched only from the packaged page_runtime.js via chrome.runtime.getURL before being injected. chrome.scripting.executeScript uses packaged files or functions defined in packaged code. CDP page expressions are fixed extension-authored routines with bounded data values; network and relay responses are treated as data and are not executed as code. No JavaScript, WebAssembly, executable module, or code payload is downloaded from a server.
```

## Permission justifications

### alarms

```text
The alarms permission wakes the Manifest V3 service worker for connection heartbeat and reconnection maintenance and for user-created page text watches. This keeps the local EvoFlux Desktop connection reliable without continuously running background code.
```

### contextMenus

```text
The contextMenus permission adds user-invoked actions for asking EvoFlux about the current page, selected text, or a link. The action opens an editable Side Chat draft; content is not submitted until the user reviews and sends it.
```

### debugger

```text
The debugger permission is the core browser-automation capability. After the user connects EvoFlux Desktop and authorizes browser control, it uses the Chrome DevTools Protocol on the selected tab for navigation, input, screenshots, page inspection, waiting, and accessibility-based interactions. The user can pause or release control at any time, and the extension detaches when control or the connection is released.
```

### nativeMessaging

```text
The nativeMessaging permission communicates only with the Native Messaging host installed by EvoFlux Desktop. It discovers the locally running desktop endpoint and obtains a process-scoped bootstrap value so the extension can establish its local connection without asking the user to copy credentials or ports.
```

### scripting

```text
The scripting permission injects only code bundled with the extension. It enables user-requested element selection, screen-region selection, page text watches, teach-mode recording, visible browser-control overlays, and explicit capture of selected or readable page content.
```

### sidePanel

```text
The sidePanel permission provides the EvoFlux Side Chat, connection status, browser-control handoff controls, page-context controls, text-watch settings, and teach-mode settings alongside the active tab.
```

### storage

```text
The storage permission keeps local extension settings and operational state, including the discovered local endpoint, scoped connection state, appearance preferences, tab/session bindings, editable drafts, text watches, teach-mode drafts, and temporary handoff state. This allows the extension to recover safely after service-worker suspension or browser restart.
```

### tabGroups

```text
The tabGroups permission groups a session's primary tab with child tabs opened for the same user-authorized EvoFlux task. It keeps related automation tabs organized and does not regroup unrelated tabs.
```

### Host permissions (`http://*/*`, `https://*/*`)

```text
EvoFlux WebBridge is a general browser assistant that must work on HTTP and HTTPS pages chosen by the user rather than on a fixed website. These host patterns allow the packaged automation, page-reading, screenshot, element-picker, text-watch, and teach-mode features to operate on the tab bound to the user's EvoFlux session and provide the URL/title fields needed for supported pages. The extension rejects internal browser pages and does not request access to file, FTP, or other non-HTTP(S) URLs. The extension uses the tabs API for tab IDs and tab operations without requesting the separate tabs permission.
```

## Data-use checklist

Declare every category actually handled by the submitted product. Based on the
current features, this includes at least website content, web history/URLs, user
activity, and personal communications entered in Side Chat. It may also include
user-provided files or identifiers depending on the EvoFlux service
configuration. Do not state that browser content stays solely on-device: users
can explicitly send page content, screenshots, selections, and files to EvoFlux.

Complete the data-use certification only after the declarations and linked
privacy policy accurately describe the production EvoFlux service.
