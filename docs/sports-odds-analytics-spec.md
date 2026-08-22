# Sports & Odds Analytics — Concept, Architecture & Next-Level Proposal

> **Purpose of this document**: a portable spec of the sports/odds analytics feature currently
> live inside the `cdiangelo/cdiangelo2` "Workspace" app (`workspace.html`), written so it can be
> handed to a *different* project/workspace as a starting brief — either to rebuild the concept
> standalone, or to design its "next level" version. It documents what actually exists in code
> today (verified by direct inspection, not by an older internal spec that had drifted out of
> date), separates that clearly from what does *not* exist yet, and closes with a concrete
> proposal for evolving it into a sharper, more proactive product.
>
> Source repo: `cdiangelo/cdiangelo2`, file `workspace.html` (~24k lines), plus `proxy.js` /
> `proxy-server/server.js`. File:line references below point at that source for traceability;
> they won't resolve in a new workspace but are useful if someone goes back to the original to
> port logic.
>
> **Note on provenance**: an earlier internal doc (`docs/future-features/sports-and-design-bot-spec.md`)
> describes a *first attempt* at this feature that broke the app and was reverted. That doc is
> obsolete — the feature was rebuilt from scratch under different internal naming and is fully
> working in the current codebase. This spec documents the rebuilt, live version.

---

## 1. Concept

A sports scores/standings/odds pane embedded inside a general-purpose "Workspace" productivity
app (spreadsheet + AI chat + notepad + whiteboard, etc.). It gives a user, per league:

- Live scores and schedule
- Standings
- News
- Player search / stats / game logs
- Betting odds (spread, moneyline, total) aggregated across sportsbooks
- A **line-movement indicator** that flags when a live game's odds have moved meaningfully
  from where they opened, as a signal for value/sharp-money spotting
- An NCAA tournament bracket tool (seasonal)
- A Claude-powered chat agent with sports-specific tools and three purpose-built "handicapping"
  personas that can reason over this data conversationally

It is *not* a standalone betting product — no bet placement, no bankroll tracking, no
account linking to sportsbooks. It's an information/analysis layer.

---

## 2. Architecture

### 2.1 Where it lives in the app

The sports feature is a **sub-tab inside a shared "Analytics" pane**, not its own top-level pane.
That pane (`#q-map`) is a 4-way tab switcher shared with Stocks, a graphing calculator, and a
concept-map tool (`workspace.html:2952-2962`). Sports is the default-active sub-tab
(`data-q4="sports"`).

Inside the sports view (`#sportsView`, `workspace.html:3142-3295`) there's a second tab strip
with six sub-tabs:

| Sub-tab | Contents |
|---|---|
| Scores/Schedule | League selector, live game list, auto-refreshes every 60s |
| Odds | League selector, per-game odds cards, **manual refresh only** (see §6) |
| Standings | Conference/division standings |
| News | League headlines |
| Players | Search + season stats, leaders, by-team browsing |
| Bracket | NCAA tournament bracket (only shown Feb–Apr), with save/load/export and an AI "Analyze" button |

Leagues supported: **NBA, NFL, MLB, NHL, NCAAB, NCAAF, Soccer (MLS), and a "Global" mode**
that aggregates several international competitions (FIFA World Cup, UEFA Champions League,
EPL, World Baseball Classic, IIHF Worlds, FIBA World Cup, CONCACAF qualifying).

A small connection-status pill in the tab bar shows green/amber/red for the live data
connection, and individual sub-tabs tint if their backing source is unreachable
(`spUpdateConnBadge`, `workspace.html:11645-11686`).

### 2.2 Data sources

Two external providers, each proxied server-side (to avoid browser CORS issues and to keep
keys off the client):

1. **ESPN** (undocumented public JSON API — `site.api.espn.com`,
   `sports.core.api.espn.com`, `site.web.api.espn.com`). Used for scores, standings, news,
   player search/stats/game logs, and NCAA bracket data. Free, no key required.
2. **The Odds API** (`api.the-odds-api.com/v4`). Used for spread/moneyline/total odds across
   multiple sportsbooks. Requires an API key and has metered quota. If it's unavailable, the
   app falls back to ESPN's own embedded `competition.odds` field, which is thinner (usually
   one consensus line, no per-book breakdown) but keeps the feature degraded-functional rather
   than dead.

A reference list of ~10–14 known sportsbook names (DraftKings, FanDuel, BetMGM, Caesars,
PointsBet, WynnBET, Barstool, Unibet, Fanatics, etc.) is used purely for display — to show
which books reported a line — not fetched individually.

**Proxy route map** (client → server, both proxy implementations expose the same routes):

| Client-facing route | Purpose |
|---|---|
| `/proxy/espn/:sport/:league/:endpoint` | Scoreboard, standings, etc. |
| `/proxy/espn-core/*` | Lower-level ESPN "core" API passthrough |
| `/proxy/espn-player/search?q=&sport=&league=` | Player search |
| `/proxy/espn-player/:sport/:league/athletes/:id/stats` | Player season stats |
| `/proxy/espn-player/.../gamelog`, `.../overview` | Player game log / bio |
| `/proxy/odds/status` | Odds API key/quota check |
| `/proxy/odds/:sport?markets=&regions=&oddsFormat=` | Live odds for a league |
| `/proxy/espn-debug`, `/health` | Diagnostics / liveness |

**Architectural note worth flagging**: the repo contains **two separate, largely-duplicate
proxy server implementations** (`proxy.js` at repo root, and `proxy-server/server.js`) with
overlapping route sets. Only the root `proxy.js` has a server-side response cache (5-minute
TTL, applied to ESPN/FMP reads, deliberately **not** applied to odds reads since odds quota is
scarcer and needs to stay fresh). Before porting this concept elsewhere, pick one
implementation rather than carrying the duplication forward.

### 2.3 API keys & credentials

Both external keys are **server-side environment variables only** — there is no client-side
key entry UI for sports/odds data (a legacy, now-disabled input for the *Claude* API key still
exists in the DOM for historical reasons, unrelated to sports):

| Key | Env var | Behavior if missing |
|---|---|---|
| The Odds API | `ODDS_API_KEY` | `/proxy/odds/*` returns `503`; app silently falls back to ESPN's embedded odds |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` (with a `.ai_key` file fallback) | Chat features degrade; unrelated to sports data itself |
| Financial Modeling Prep | `FMP_API` | Used by the Stocks sub-tab, not sports |

ESPN requires no key.

**Gap found during this review**: the repo's only `.env.example`
(`proxy-server/.env.example`) does **not** list `ODDS_API_KEY` or `FMP_API`, even though the
server code reads both via `process.env`. Anyone standing this up fresh needs to know about
these two env vars from source inspection, not from the example file. **Fix this in any new
build** — keep the example env file in sync with what the server actually reads.

### 2.4 Connection validation ("data source health check")

An admin-only "Sources" panel (`workspace.html:19473-19580`) actively pings every external
dependency on demand and renders a colored status dot per source (gray=checking,
green=ok, amber=partial, red=failed):

- **Proxy server** — hits its own `/health`.
- **Claude AI** — hits `/proxy/ai/status`, checks `configured`.
- **ESPN** — fetches a live NBA scoreboard and checks the response actually contains events.
- **The Odds API (key/quota)** — hits `/proxy/odds/status`; specifically flags HTTP 401 as
  "key expired/invalid" rather than a generic failure.
- **The Odds API (live data)** — goes further than a status ping: it actually fetches live
  NBA odds, counts how many distinct sportsbooks responded, and marks the check "partial" if
  fewer than 3 books reported (a proxy for "the feed is technically up but thin").
- Plus non-sports sources (FMP, Yahoo Finance, Google News RSS, Robinhood, GNews, Archive.is)
  checked the same way, in the same panel.

This is a pure diagnostic tool — it doesn't gate any feature or persist history, it just tells
an admin "is everything reachable right now." A narrower, ESPN-specific diagnostic is also
exposed both as a devtools console function and as a Claude tool (`espn_diagnostics`).

**This is a good pattern worth keeping in any rebuild** — one central panel, one `check()`
contract per source, real requests (not just "is the URL configured").

---

## 3. Odds Swing / Line-Movement Analysis — what actually exists

This is the most distinctive analytical feature, so it's documented in full detail.

### 3.1 Capturing the "opening" baseline

While the Scores tab auto-refreshes every 60 seconds, every pre-game event returned by ESPN is
scanned for an embedded odds line. The **first time** a given matchup is seen in a `pre` state,
that line is stored as the game's opening/baseline odds (spread, total, away moneyline, home
moneyline) — keyed by `"away @ home"` (lowercased) — into `localStorage`, pruned automatically
after 24 hours.

If a game is *never* observed pre-game (e.g., the app was opened mid-game), the **first live
odds seen** are used as a stand-in baseline and flagged internally as "captured live" rather
than a true opening line. If a genuine pre-game line is later observed for that same game (rare,
but possible with backfill), it replaces the live-captured stand-in. Once a true baseline exists,
it is never overwritten for that game.

### 3.2 Comparing current vs. opening

For any game currently **live** (`state === 'in'`), current odds are diffed against the stored
baseline across four fields, each with its own "this counts as a major move" threshold:

| Field | Major-move threshold |
|---|---|
| Spread | ±2.5 points |
| Total (O/U) | ±4 points |
| Away moneyline | ±80 (American odds) |
| Home moneyline | ±80 (American odds) |

Independent of those thresholds, a **moneyline sign flip** (the favorite becomes the underdog
or vice versa) is *always* treated as a major move — this is the strongest signal the feature
surfaces.

**Important limitation**: swings are only computed and displayed for **live** games. A game
that hasn't tipped off yet, or one that's already final, never shows a movement badge — even
though the opening line was captured for it. If "track movement from open through tip-off" is
a goal for the next version, this is a real gap to close (see §5).

### 3.3 Surfacing to the user

- Each odds card gets a colored left border/background tint: orange for a major (non-flip)
  move, red for a sign flip.
- Cards with at least one major-moving field get a "LINE MOVEMENT vs OPENING" banner listing
  each major field's open → current values with a small colored delta chip.
- A sign-flip field additionally carries the literal label **"Favorite/underdog FLIP — potential
  arb"** — this is UI copy only; see §4, there is no arbitrage math computing or confirming that
  claim.
- A per-tab header summarizes total live games and total games currently showing a swing.

### 3.4 What this is *not*

- Not a persisted time series. There's no history of how a line moved minute-by-minute — only
  "opening" and "current," compared live.
- Not applied pre-game. Line steam before tip-off (often the sharpest signal in real handicapping)
  isn't surfaced at all today.
- Not cross-referenced with betting volume, public %, or any market-depth signal — this feature
  is price-only.

---

## 4. Arbitrage Detection — status: **not implemented**

This is the most important "keep me honest" item in this document. Despite the UI displaying
the phrase "potential arb" next to moneyline sign flips, **there is no arbitrage or de-vig math
anywhere in the codebase** — no no-vig probability calculation, no two-sided stake-sizing
check, no cross-book guaranteed-profit detection. The phrase is descriptive copy hinting that a
sign flip *might* correlate with an arbitrage window across books, but nothing computes,
confirms, or quantifies that. Treat "arbitrage opportunities" as a **feature to design and
build**, not one to port from existing logic. See §7.4 for a concrete proposal.

---

## 5. Caching & Data Retention

There is **no daily-snapshot or multi-day historical archive** of odds — that concept existed
only in the earlier, obsolete internal doc and was never actually built. What exists today:

- **Opening-odds baseline** — one value per game in `localStorage`, self-pruned after 24h.
  This is a rolling "since this game started" reference point, not a time series.
- **In-memory odds-list cache** — the last-rendered odds HTML per league is cached client-side
  and served until the user manually clicks Refresh (deliberately, to conserve API quota). Lost
  on page reload; not a `localStorage`/TTL cache.
- **Scores** auto-refresh every 60s regardless — no caching applied there.
- **Server-side**: a generic 5-minute cache applies to ESPN/FMP reads, explicitly *not* to odds
  reads (kept always-fresh given the quota sensitivity).

If the next-level version wants trend analysis, backtesting, or CLV tracking, a **real
persisted time-series store is a prerequisite** — nothing today retains more than "opening vs.
right now."

---

## 6. Claude/AI Tool Integration & Personas

Sports-related tool definitions available to the in-app Claude agent:

| Tool | Purpose |
|---|---|
| `set_sports_league` | Switch the active league across scores/standings/odds |
| `get_sports_scores` | Live scores/schedule (or all global sources at once) |
| `get_sports_odds` | All-bookmaker odds for a league, with a computed best-line-per-market; falls back to ESPN's embedded odds if the API is down |
| `get_event_odds` | Same, scoped to one specific matchup, with a "line-shopping" framing in the response |
| `get_sports_standings` | Team records/streaks |
| `get_player_stats` / `get_player_gamelog` | Player search, season stats, recent-game trends |
| `espn_diagnostics` | Runs the ESPN health-check battery |
| `get_bracket_state` / `generate_bracket` | Read/populate the NCAA bracket |

Three purpose-built chat personas consume these tools:

- **Gambling Edge Analyst** — general sports-betting analysis persona.
- **March Madness** — seasonal (Feb–Apr), bracket-focused.
- **Contrarian Statistician** — covers both sports and equities, framed around
  contrarian/sharp-money reasoning.

All three are instructed to be "tool-first" (must call real tools before answering rather than
guessing). **Important caveat**: their system prompts instruct them to reason about "public
betting %," "sharp vs. public splits," "reverse line movement scoring," and "closing line
value" — but **none of the actual tools return that data**. The model is left to *narratively
estimate* these concepts rather than pull them from a real feed. Anyone porting this concept
should either (a) source real public-betting/steam data, or (b) rewrite the persona prompts to
stop implying data that doesn't exist — the current state risks the AI sounding more
data-backed than it is.

---

## 7. Proposal: Taking This to the Next Level

The current feature is a solid **data-display + light-signal layer**: it shows odds, flags
one class of movement, and lets an LLM narrate over both. To become genuinely proactive,
condensed, and actionable — the standard the user is holding this to — it needs to move from
"here's data, ask me about it" to "here's what matters, right now, and why."

### 7.1 A real Insight Feed (the central next-level idea)

Replace "browse odds tab, notice a colored border" with a ranked, condensed feed: a short list
of the day's/hour's highest-signal items across all tracked leagues — a sign flip here, a
steam move there, a mispriced line vs. a model estimate — each rendered as **one line, plain
language, with a confidence/strength indicator**, not a data dump. This is the "proactive,
concise, actionable" gap the current UI doesn't close: today you have to already be looking at
a specific game to see its movement.

### 7.2 Persisted historical time series

Store every observed line (not just opening vs. current) in a real time-series store — a
lightweight table keyed by `(game, book, market, timestamp)` is enough to start. This unlocks:
minute-by-minute movement charts, pre-game steam detection (currently impossible — swings only
show live), and the historical base needed for CLV tracking and backtesting any "this signal
predicted a result" claim before trusting it.

### 7.3 Extend swing detection to pre-game

Since opening lines are already captured pre-game, computing and surfacing movement *before*
tip-off is a small lift relative to its value — pre-game steam is often the sharpest signal in
real handicapping and today's implementation silently discards it.

### 7.4 Real arbitrage / no-vig detection

Build what the UI currently only implies:
- Convert each book's moneyline/spread/total price to implied probability, de-vig per book
  (remove the bookmaker's margin) to get a fair-value estimate.
- Compare the *best* available price on each side, across books, against the de-vigged fair
  probability — flag true two-sided arbitrage (guaranteed profit regardless of outcome) and,
  separately, "positive expected value" single-side opportunities (a looser, more common signal
  than pure arb).
- Show the required stake split for an arb window to be genuinely riskless, given current
  prices — not just "the ML flipped, might be something here."

### 7.5 Closing Line Value (CLV) tracking

If a user records a line they'd act on (or actually bets, off-platform), compare it after the
fact to the closing line. CLV is the standard way serious bettors evaluate whether their
process has edge over time — the persona prompts already gesture at this concept but nothing
computes it. This requires the historical store from §7.2 plus a lightweight "record my line"
action.

### 7.6 Proactive alerting, not pull-based browsing

Push/email/webhook notification when a tracked game crosses a swing threshold, a sign flips, or
a de-vigged arb window opens — instead of requiring the user to have the tab open. Even a
simple "watchlist + threshold + notify" loop would meaningfully raise how actionable this
feature is, versus today's passive-refresh model.

### 7.7 Kelly-criterion stake sizing

Once real edge estimates exist (from de-vig + a model or the persona's own probability
estimate), surface a suggested stake size (fractional Kelly, capped) alongside any flagged
opportunity — turns "here's a signal" into "here's a signal and how much it's worth acting on."

### 7.8 Source real public-betting / steam data

Close the gap in §6: either integrate an actual public-bet-percentage/handle feed (several
commercial odds/handle APIs exist) so the personas' RLM/sharp-vs-public reasoning is grounded in
real data, or explicitly relabel that reasoning as model inference so users aren't misled about
its basis.

### 7.9 Architectural cleanup that unblocks the above

- Consolidate the two duplicate proxy servers into one.
- Add a real database (even SQLite/Postgres) for the time-series data in §7.2 — `localStorage`
  won't scale past "one browser tab, 24 hours."
- Fix `.env.example` to list every env var the server actually reads.
- Decide whether cross-book "best line" aggregation (already computed for one AI tool) should
  become a first-class UI feature in its own right, not just something the chat agent can
  compute on request.

### 7.10 Suggested phased rollout

1. **Foundation**: real time-series storage, extend swing detection to pre-game, fix env docs.
2. **Trust**: real de-vig/arbitrage math, replace the "potential arb" hint with actual numbers.
3. **Proactivity**: condensed insight feed + threshold-based alerting/watchlists.
4. **Depth**: CLV tracking, Kelly sizing, backtestable signal scoring, real public-betting data
   source.

Each phase is independently shippable and builds on real data the phase before it collected —
avoid building alerting or CLV (phases 3–4) on top of the current 24-hour-rolling,
non-persisted baseline; it won't hold up.

---

## Appendix: Source File Index (for reference against the original repo)

| Area | Location |
|---|---|
| Pane/tab structure | `workspace.html:2952-3295` |
| Tab-switch wiring | `workspace.html:10089-10103`, `11616-11637` |
| Connection status badge | `workspace.html:11643-11792` |
| Scores fetch + opening-odds capture | `workspace.html:11843-11947` |
| Opening-odds core logic | `workspace.html:12230-12337` |
| Odds card rendering | `workspace.html:12410-12660` |
| Odds fetch (API + ESPN fallback) | `workspace.html:12673-12916` |
| Data-source health-check panel | `workspace.html:19472-19580` |
| Claude tool schemas | `workspace.html:21763-21774` |
| Claude tool handlers | `workspace.html:22412-22600+` |
| Persona system prompts | `workspace.html:17740-17960+` |
| Proxy routes | `proxy.js:60-390`, `653-661` |
| Env var example (incomplete) | `proxy-server/.env.example` |
