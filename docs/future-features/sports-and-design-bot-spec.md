# Future Features Spec: Sports Analytics & Design Bot

> Extracted from workspace.html before revert to `c6dd6f6`.
> Both features were added in commits `7cb22c1` (Sports) and `db02d88` (Design Bot).
> They broke button interactivity across all panes; five fix attempts failed.

---

## 1. Sports Analytics Pane

### 1.1 What It Was Supposed to Do

A full sports analytics pane (`q-sports`) supporting four leagues (NBA, NCAAB, MLB, NHL) with:
- **Scores tab**: Live/final/scheduled games from ESPN, with inline odds overlay
- **Standings tab**: Conference-grouped standings with W-L, PCT, GB, streak
- **Leaders tab**: Statistical leaders by category (PPG, ERA, goals, etc.)
- **Odds tab**: Daily odds snapshot from The Odds API — moneyline, spread, O/U, implied probability, vig%
- **News tab**: ESPN headlines per league
- Claude AI tool integration: 12 tool definitions letting the agent query scores, standings, player stats, game detail, odds, and slate analysis
- Context injection into the main workspace context string (`getSportsContext()`)

### 1.2 HTML Structure

```html
<!-- Pane added to the grid -->
<div class="pane" id="q-sports" style="grid-column:5;grid-row:3;display:none;">
  <div class="p-head">
    <span class="p-title"><span class="p-icon" style="font-size:.7rem;">&#127944;</span> Sports</span>
    <div class="p-spacer"></div>
    <select id="sportsLeague">
      <option value="nba">NBA</option>
      <option value="ncaab">NCAAB</option>
      <option value="mlb">MLB</option>
      <option value="nhl">NHL</option>
    </select>
    <button id="sportsRefreshOdds" class="p-btn">Refresh Odds</button>
    <div class="zoom-controls">...</div>
    <button class="p-btn" data-expand="q-sports" title="Expand">&#x2922;</button>
  </div>
  <div class="p-body" style="display:flex;flex-direction:column;">
    <div class="toolbar">
      <div class="toggle-group" id="sportsTabs">
        <button class="active" data-stab="scores">Scores</button>
        <button data-stab="standings">Standings</button>
        <button data-stab="leaders">Leaders</button>
        <button data-stab="odds">Odds</button>
        <button data-stab="news">News</button>
      </div>
    </div>
    <div id="sportsContent"></div>
  </div>
</div>

<!-- Tab button in nav bar -->
<button data-pane="q-sports">Sports</button>

<!-- Pane registered in layout arrays -->
{ id: 'q-sports', label: 'Sports' }
{ id: 'q-sports', label: 'Sports', icon: '🏈', desc: 'Live scores, standings, odds, and sports news' }
```

### 1.3 CSS

```css
/* SPORTS MODULE — Phase 5: Live game pulse indicator */
/* (standard pulse animation for live game dots — no custom styles beyond inline) */
```

### 1.4 JavaScript Logic

#### Data Layer (Phase 3) — ESPN proxy fetches
All fetches go through `PROXY_BASE + '/proxy/espn?sport=LEAGUE&endpoint=...'`:
- `fetchScoreboard(league, dateStr)` — scoreboard with team scores, status, broadcast
- `fetchStandings(league)` — conference standings with parseStandingsEntry helper
- `fetchTeamList(league)` — team IDs, names, colors, logos
- `fetchTeamRoster(league, teamId)` — player roster with positions
- `fetchPlayerStats(league, athleteId)` — season stats
- `fetchGameSummary(league, eventId)` — box score, leaders, scoring plays
- `fetchSportsNews(league, limit)` — ESPN news articles
- `fetchTeamSchedule(league, teamId)` — team schedule with results
- `fuzzyTeamMatch(input, candidate)` — name matching helper

#### Caching Layer (Phase 7)
- `sportsCacheGet(key)` / `sportsCacheSet(key, data, ttlMinutes)` — localStorage with TTL
- `clearSportsCache()` — purge all `sports_*` keys
- TTLs: live scores 3min, final scores 15min, standings 60min, teams 7 days, roster 24h

#### Odds System (Phase 2) — The Odds API
- `takeDailyOddsSnapshot()` — fetches odds across all 4 leagues, stores in localStorage
- `getOddsSnapshot()` / `getSnapshotAge()` — read stored snapshot
- `getGameOdds(league, home, away)` — lookup specific game odds
- `updateOddsHistory(snapshot, totalGames)` — maintain 30-day history archive
- `impliedProb(odds)` — convert American odds to implied probability
- Requires user-provided API key stored as `odds_api_key` in localStorage

#### Claude Tools (Phase 4) — 12 tool definitions
```
get_scores, get_standings, get_player_stats, get_team_summary,
get_game_detail, get_sports_news, get_odds_snapshot, get_odds_history,
analyze_betting_slate, refresh_odds_snapshot, get_league_leaders,
get_league_overview
```
Each has a handler in `SPORTS_TOOL_HANDLERS` object.

#### Pane UI (Phase 5)
- `initSportsPane()` IIFE — tab switching, league selector, render functions
- `renderScoresTab()`, `renderStandingsTab()`, `renderLeadersTab()`, `renderOddsTab()`, `renderNewsTab()`
- Inline `onclick` handlers on score cards: `window._sportsFetchGameDetail(league, eventId)`
- Slate analysis button: `window._sportsAnalyzeSlate(league)`

#### Context Injection (Phase 6)
- `getSportsContext()` — builds summary of odds snapshot + live games
- Injected into `getWorkspaceContext()` as `Sports: ...`

#### Admin UI (Phase 1)
- Odds API key input/save added to `#aiApiKeySection`
- "Clear Sports Cache" button

### 1.5 Proxy Server Endpoints Required
- `GET /proxy/espn?sport=LEAGUE&endpoint=ENDPOINT` — ESPN API proxy
- `GET /proxy/odds?sport=LEAGUE&apiKey=KEY` — The Odds API proxy

### 1.6 Known Issues
- Adding the pane + 12 tool definitions + IIFE UI init caused **all button handlers across every pane to stop firing** (CSS hover still worked, but JS click events did not)
- Five repair commits (`4380eb9` through `b469cec`) all failed to fix it
- Root cause likely: the IIFE or the pane registration code interfered with event delegation or re-initialized DOM in a way that detached existing handlers
- The inline `onclick="window._sportsFetchGameDetail(...)"` pattern is fragile — relies on window globals

---

## 2. Design Bot Agent

### 2.1 What It Was Supposed to Do

A second Claude agent instance focused exclusively on whiteboard/draw pane and concept map:
- Floating chat panel anchored to the Claude pane
- Mini animated robot character in the desk scene (beret + palette, bouncing animation)
- Auto model selection (Haiku for simple, Sonnet for complex requests)
- Agentic loop with up to 8 tool-call iterations
- Canvas bounds checking and self-correction
- Design template library (two-panel, quad, hero-banner, etc.)
- Cross-bot "Send to Design Bot" button injected into main Claude responses via MutationObserver

### 2.2 HTML Structure

```html
<!-- Mini character in desk scene -->
<div class="design-bot-char" id="designBotChar" title="Click to open Design Bot chat">
  <div class="db-mini-beret"></div>
  <div class="db-mini-head">
    <div class="db-mini-eyes"><span class="eye"></span><span class="eye"></span></div>
  </div>
  <div class="db-mini-torso"></div>
  <div class="db-mini-palette"></div>
  <span class="db-label">Design Bot</span>
</div>

<!-- Floating panel created dynamically by initDesignBotUI() IIFE -->
<!-- Appended to #q-claude .p-body -->
<div id="designBotPanel">
  <div class="db-header">
    <span class="db-title">Design Bot</span>
    <span class="db-subtitle">Whiteboard · Concept Map</span>
    <select id="dbModelSelect">Auto | Haiku | Sonnet</select>
    <span id="dbCostLabel">$0.0000</span>
    <button id="dbCloseBtn">×</button>
  </div>
  <div class="db-msgs" id="dbMsgs"></div>
  <div class="db-input-row">
    <textarea id="dbInput" placeholder="Describe a layout..."></textarea>
    <button id="dbSend">Draw</button>
  </div>
</div>
```

### 2.3 CSS (~35 lines)

```css
/* Mini Design Bot robot in desk scene */
.design-bot-char { position: absolute; bottom: 16px; z-index: 6; left: 50%; margin-left: 54px; ... }
.design-bot-char.db-working { animation: dbBounce 0.6s ease-in-out infinite; }
@keyframes dbBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }

/* Floating Design Bot chat panel */
#designBotPanel { display: none; position: absolute; bottom: 0; right: 4px; width: 280px; height: 320px; z-index: 70; ... }
#designBotPanel.db-open { display: flex; }
/* ... message styles, input row, tool badge, drawing banner ... */
```

### 2.4 JavaScript Logic

#### State Object (Phase 1)
```js
const designBot = {
  history: [], model: 'claude-haiku-4-5-20251001',
  sessionTokensIn: 0, sessionTokensOut: 0, sessionCost: 0,
  isThinking: false, iterationCount: 0, maxIterations: 8,
  lastToolCall: null, autoModel: true
};
```

#### System Prompt (Phase 2)
- Scoped to whiteboard + concept map tools only
- Includes behavioral rules (check canvas state first, use templates, stay in-bounds)
- Lists available templates and tools

#### Allowed Tools (Phase 3)
```
get_draw_pane_state, draw_shape, draw_chart_on_whiteboard,
annotate_whiteboard, draw_summary_card, add_text_overlay,
write_to_draw_pane, clear_draw_pane,
add_concept_node, add_concept_edge, remove_concept_node,
clear_concept_map, set_concept_map_layout, get_concept_map,
show_toast, get_design_templates
```

#### Template Library (Phase 7)
Seven templates with pre-calculated zone coordinates:
`two-panel`, `quad`, `hero-banner`, `three-column`, `dashboard`, `timeline`, `concept-focus`

#### Core Functions
- `buildDesignBotTools()` — filters main AGENT_TOOLS to allowed subset + adds template tool
- `designBotBoundsCheck(x, y, w, h, canvasW, canvasH)` — clamp to canvas with 20px margin
- `verifyDesignBotDraw(toolName, toolInput, toolResult)` — post-tool verification, retry with adjusted coords on error
- `designBotCallTool(toolName, toolInput)` — route + bounds-enforce + verify
- `buildDesignBotContext()` — canvas dimensions, layers summary, concept map summary, last action
- `designBotAutoSelectModel(userMessage)` — complexity scoring for Haiku vs Sonnet
- `addDesignBotMsg(role, text)` — append to `#dbMsgs`
- `addDesignBotToolBadge(toolName, input)` — compact tool call indicator
- `sendDesignBotMessage(userMessage)` — full agentic loop with SSE streaming, fallback to non-streaming
- `updateDesignBotCost()` — refresh cost label

#### UI Init (Phase 5) — `initDesignBotUI()` IIFE
- Creates `#designBotPanel` dynamically, appends to `#q-claude .p-body`
- Creates `#dbDrawingBanner` in whiteboard pane
- Character click toggles panel open/closed
- Close button, send button, Enter key handler
- Model selector (Auto/Haiku/Sonnet)
- **MutationObserver on `#aiMsgs`**: watches for assistant messages containing draw keywords, injects "→ Send to Design Bot" button

### 2.5 Known Issues
- The `initDesignBotUI()` IIFE **appends a child to `#q-claude .p-body`** — this may trigger reflow/relayout that interferes with existing click handlers
- The **MutationObserver on `#aiMsgs`** modifies assistant message nodes by appending buttons — this can interfere with existing DOM event listeners or cause unexpected re-renders
- The IIFE runs at script parse time (bottom of file) — if any earlier pane init failed or threw, the Design Bot init could cascade the failure
- Direct `.onclick =` assignments (e.g., `charEl.onclick`, `dbSend.onclick`) may overwrite existing handlers if element IDs collide

---

## 3. Recommended Implementation Approach for Next Attempt

### 3.1 Isolate New Features
- **Do NOT use IIFEs that run at parse time.** Instead, register an init function and call it from a central `initAllPanes()` dispatcher.
- Each feature should be wrapped in a try/catch so failures don't cascade.
- Use `addEventListener` instead of `.onclick =` to avoid overwriting handlers.

### 3.2 Use Event Delegation
- The root cause of the button breakage was likely direct binding conflicts. Use a single delegated click handler on the pane body:
  ```js
  document.getElementById('q-sports').addEventListener('click', e => {
    const tab = e.target.closest('[data-stab]');
    if (tab) { /* handle tab switch */ }
    const gameCard = e.target.closest('[data-event-id]');
    if (gameCard) { /* handle game detail */ }
  });
  ```
- Avoid inline `onclick="window.foo()"` — use `data-*` attributes + delegation.

### 3.3 Lazy Initialization
- Only init the Sports pane JS when the tab is first opened (not on page load).
- Only init the Design Bot when the character is first clicked.
- This reduces parse-time side effects and startup cost.

### 3.4 MutationObserver Safety
- The Design Bot's observer on `#aiMsgs` should be opt-in, activated only when the Design Bot panel is open.
- Disconnect the observer when the panel closes.
- Never modify nodes inside an observer callback that watches the same parent — this can cause infinite loops or layout thrashing.

### 3.5 Testing Checklist Before Merge
1. Open every pane and click every button — verify all handlers fire
2. Open browser console — check for uncaught exceptions during init
3. Test with API key absent — ensure graceful degradation
4. Test mobile layout — ensure no overflow or z-index conflicts
5. Test light mode and dark mode
6. Verify no `window.*` globals collide with existing names

### 3.6 Incremental Rollout
- Add Sports pane first. Verify no regressions. Commit.
- Add Design Bot second. Verify no regressions. Commit.
- Never add both in a single commit.
