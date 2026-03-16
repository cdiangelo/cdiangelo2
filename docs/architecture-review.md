# Architecture Review: workspace.html

> Post-revert analysis of the Interactive Workspace (10,855 lines, single-file HTML app)
> Commit: `c6dd6f6` — last known working state
> Date: 2026-03-16

---

## A) Scaling Bottlenecks

### eval() Usage
None found. Clean on this metric.

### innerHTML Re-renders
**73 innerHTML assignments found.** Many replace entire pane contents:
- `np.innerHTML = page.content` — replaces entire notepad (line 3424)
- `t.innerHTML = h` — full spreadsheet grid rebuild (line 4699)
- `el.innerHTML = ''` — workspace list clear + rebuild (line 6815)
- News feed, stock dashboard, chart renders all use full innerHTML replacement

**Impact**: Every innerHTML replacement orphans all event listeners on child elements, resets scroll position, and forces full DOM reparse. This is the primary source of handler loss.

### Synchronous DOM Loops
~20+ `querySelectorAll + forEach` patterns with DOM mutations inside the loop:
- Line 2271: Auth user items — handler assignment loop
- Line 3873: Whiteboard layer cleanup — `.remove()` in forEach
- Line 4702: Sparkline canvases — canvas render in forEach
- Line 5121-5159: Context menu items — onclick assignment loop
- Line 8408: User drill links — handler rebinding

### MutationObserver Usage
**2 observers, 0 disconnections:**
1. **Line 6789**: `wsObserver` on notepad — observes `childList + subtree + characterData`, triggers auto-save with 2s debounce. Never disconnected during pane switches.
2. The (now-removed) Design Bot observer on `#aiMsgs` — was injecting buttons into Claude responses.

**Memory concern**: Observer on notepad subtree fires on every keystroke (though debounced for save). At scale with more panes, accumulated undisconnected observers would degrade performance.

### What Breaks Past 15k-20k Lines
1. **Parse time**: Single `<script>` block grows linearly — browser must parse all 10k+ lines before first paint
2. **Handler rebinding cascade**: Each new feature adds more querySelectorAll loops that re-run on pane switches
3. **Global variable collisions**: 100+ top-level variables with no namespace isolation
4. **No virtual scrolling**: AI chat log, news feed, workspace list all render fully into DOM
5. **IIFE init ordering**: 6 IIFEs run at parse time; a thrown error in one cascades to all subsequent code

---

## B) Performance Quick Wins

### 1. Debounce Missing Handlers
**Only 1 debounced handler found** (workspace auto-save at 2000ms). These should be debounced:
- `window.addEventListener('resize', checkMobile)` — line 2900
- `window.addEventListener('resize', resizeWB)` — line 3657
- Stock chart `mousemove` — line 6035 (fires every pixel)
- Whiteboard mouse handlers — lines 3673-3731

**Fix**: Add a shared `throttle(fn, ms)` utility; wrap resize/mousemove handlers.

### 2. Lazy-Load Pane Content
Currently all panes initialize on page load:
- Stock dashboard renders at line 5860
- News search listeners active at line 7505
- AI chat input listener at line 10465
- Graph calculator, concept map, spreadsheet all init eagerly

**Fix**: Gate pane init behind a `firstActivated` flag checked in the tab click handler (lines 2850-2854). Only run heavy init when tab is first opened.

### 3. Reduce setInterval Polling
**9 setIntervals found**, several unnecessary:
- Line 3469: Notepad auto-save every 5s (redundant with MutationObserver)
- Line 10242: Stall check every 5s (indefinite)
- Line 7204: Stock refresh interval
- Line 9582/9602: Robot animation loops (cosmetic, but always running)

**Fix**: Replace notepad interval with observer-only save. Use `requestAnimationFrame` for animations. Clear intervals when panes are inactive.

### 4. Duplicate Event Listeners
Multiple resize listeners registered independently. Canvas mouse handlers (mousedown, mousemove, mouseup) on whiteboard could be consolidated.

---

## C) Structural Recommendations

### Current Structure
- **1 HTML file**, 10,855 lines
- **6 IIFEs** for scoping (auth, mobile nav, OAuth, news, Robinhood)
- **100+ global variables** scattered throughout
- **No build step**, no imports, no modules
- **No centralized state** — state lives in globals + localStorage, manually synced

### Modular Version (Multi-File)
```
workspace/
├── index.html          (shell: head, CSS vars, grid layout, script imports)
├── css/
│   └── workspace.css   (all styles extracted)
├── modules/
│   ├── state.js        (centralized store: EventEmitter + localStorage sync)
│   ├── pane-manager.js (tab switching, layout, expand/collapse)
│   ├── notepad.js      (pages, rendering, auto-save)
│   ├── whiteboard.js   (canvas, layers, tools)
│   ├── spreadsheet.js  (grid, formulas, clipboard)
│   ├── ai-chat.js      (message loop, streaming, tool dispatch)
│   ├── stocks.js       (tickers, charts, Robinhood)
│   ├── news.js         (feed, reader, watchlist)
│   ├── graph-calc.js   (expression parsing, canvas rendering)
│   ├── concept-map.js  (nodes, edges, layout algorithms)
│   ├── auth.js         (login, user management, admin)
│   └── api.js          (proxy calls, fetch wrappers)
├── lib/
│   ├── debounce.js     (shared throttle/debounce)
│   └── dom.js          ($ selector, event delegation helpers)
└── build.js            (esbuild config → single bundle for prod)
```

**Migration path**: Use `<script type="module">` imports. No framework needed. Each module exports an `init()` function called by the pane manager on first activation.

### Micro-State Manager (No Framework)
```js
// state.js — ~30 lines
const state = {};
const listeners = {};

export function getState(key) { return state[key]; }

export function setState(key, value) {
  state[key] = value;
  (listeners[key] || []).forEach(fn => fn(value));
  localStorage.setItem('ws_' + key, JSON.stringify(value));
}

export function subscribe(key, fn) {
  (listeners[key] = listeners[key] || []).push(fn);
  return () => { listeners[key] = listeners[key].filter(f => f !== fn); };
}

export function loadState(key, defaultValue) {
  try {
    const stored = localStorage.getItem('ws_' + key);
    state[key] = stored ? JSON.parse(stored) : defaultValue;
  } catch { state[key] = defaultValue; }
  return state[key];
}
```

Each pane subscribes to relevant keys; state changes trigger re-renders only in affected panes.

### Re-introducing Sports & Design Bot Safely
1. **Separate module files**: `sports.js` and `design-bot.js`
2. **Lazy init**: Register with pane manager, init on first tab click
3. **Wrap in try/catch**: Failures must not cascade
4. **Use event delegation**: No direct onclick assignments on dynamic elements
5. **MutationObserver discipline**: Connect on panel open, disconnect on close
6. **Incremental commits**: Add Sports first → verify → commit. Then Design Bot → verify → commit.
7. **No IIFEs at parse time**: Export an `initSports()` / `initDesignBot()` function, called by the pane manager

---

## D) Button Handler Pattern

### Current State
| Pattern | Count | % |
|---------|-------|---|
| `.onclick =` (property) | 138 | 65% |
| `onclick="..."` (inline HTML) | 55 | 26% |
| `addEventListener('click')` | ~20 | 9% |

### Why Handlers Broke
The Sports + Design Bot additions triggered this failure chain:
1. New IIFE code ran at parse time, querying DOM elements that may not exist yet
2. New `innerHTML` assignments in pane rendering orphaned existing handlers
3. `MutationObserver` on `#aiMsgs` modified DOM nodes, potentially triggering re-renders
4. Direct `.onclick =` assignments on shared elements (like pane buttons) overwrote existing handlers

### Recommended Canonical Pattern
**Event delegation on pane bodies:**

```js
// One listener per pane, handles all clicks within it
document.getElementById('q-sports').addEventListener('click', e => {
  // Tab switching
  const tab = e.target.closest('[data-stab]');
  if (tab) {
    handleTabSwitch(tab.dataset.stab);
    return;
  }

  // Game card click
  const card = e.target.closest('[data-event-id]');
  if (card) {
    handleGameDetail(card.dataset.eventId);
    return;
  }

  // Analyze button
  if (e.target.matches('[data-action="analyze"]')) {
    handleAnalyze();
    return;
  }
});
```

**Rules:**
1. Never use `.onclick =` on dynamically created elements — use delegation
2. Never use inline `onclick="window.foo()"` — use `data-*` attributes
3. One delegated listener per pane container (on `.p-body`)
4. When rendering with innerHTML, use `data-` attributes for actions, not handler assignments
5. If a handler MUST be direct (e.g., canvas mousedown), use `addEventListener` and track it for cleanup

### Migration Priority
1. **Immediate**: Convert all inline `onclick=` to `data-action` + delegation
2. **Next**: Convert `.onclick =` in render loops to delegation
3. **Later**: Consolidate multiple `addEventListener` calls into per-pane delegators

---

## Summary

| Area | Status | Risk Level |
|------|--------|------------|
| innerHTML re-renders | 73 assignments, many full-pane | HIGH |
| Event delegation | <10% of handlers delegated | HIGH |
| Debouncing | 1 of ~15 handlers debounced | MEDIUM |
| MutationObservers | 2 observers, 0 disconnections | MEDIUM |
| Global state | 100+ vars, no central store | HIGH |
| Lazy loading | No panes lazy-loaded | LOW-MEDIUM |
| eval() | None | CLEAN |
| Module boundaries | 0 modules, 1 file | HIGH |

The app is at the **critical threshold** (~11k lines) where architectural debt blocks new feature development. The Sports + Design Bot breakage was a symptom of missing delegation and parse-time IIFE conflicts. The recommendations above would make the codebase safe for feature additions up to 20k+ lines.
