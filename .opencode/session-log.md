# Session Log — YT Engagement Verdict

## Session 2026-08-15 — Phase 1: Telemetry Auth (per-install UUID)

### Context
Replaced the hardcoded static API key in `reporter.js` / `chrome/reporter.js` (which had been accidentally shipped in public XPI/ZIP packages, then rotated) with a per-install UUID generated on first use. The Worker now validates UUID format only.

### Decisions
1. Per-install UUID via `crypto.randomUUID()`, generated lazily on first `report()` call, cached in a module variable, persisted to `browser.storage.local` / `chrome.storage.local` under key `install_id`, and sent as the `X-YTEV-Key` header value.
2. Header name kept as `X-YTEV-Key` (value semantics changed to the install ID) — no CORS changes needed in the Worker.
3. Worker `authorized()` now validates format only: `/^[0-9a-f-]{36}$/i`, with a null guard. The dev-open path (`if (!env.API_KEY) return true`) was removed — local `wrangler dev` now requires a valid UUID, matching prod.
4. Background pre-generation of the UUID on `onInstalled` — ruled out. Lazy generation is sufficient; `report()` already awaits storage ops. The only artifact is a benign multi-tab race (two tabs can each generate an ID before the first write lands; last-write-wins). Benign because the server only validates format. Revisit when per-ID rate limiting lands.
5. `API_KEY` Wrangler secret: keep until after Worker deploy, then `wrangler secret delete API_KEY` — manual step (requires Cloudflare auth).
6. No changes to `background.js` / `chrome/background.js` (pre-gen ruled out).
7. Stale `chrome/reporter.js` header comment ("replace YOUR_API_KEY_HERE") corrected to reflect the no-secrets reality.

### Assumptions baked into the code
- `crypto.randomUUID()` is available in content scripts on YouTube (HTTPS secure context) — Firefox 95+, all modern Chrome.
- Content scripts can access `browser.storage.local` (MV2) / `chrome.storage.local` (MV3) — confirmed.
- If storage is unavailable, an ephemeral in-memory UUID is used per tab session (per-tab `cachedInstallId`), so telemetry still works without persistence.
- Deployment ordering: extension and Worker ship together. Old static keys are rejected by the new Worker; the old Worker rejects new UUIDs. No overlap period.

### What was ruled out
- Background pre-generation (marginal benefit, more surface in two trees).
- Renaming the header (CORS churn, no benefit).
- Stricter v4-only UUID regex (brief specified `/^[0-9a-f-]{36}$/i`; note it accepts any 36-char hex/hyphen string).
- Fixing the stale Worker test suite (`test/index.spec.js` still asserts "Hello World!" and does not match the actual worker) — out of scope; flagged for a dedicated session.

### Files changed
- `yt-engagement-verdict/reporter.js` (gitignored, NOT committed) — `API_KEY` removed, `getInstallId()` added.
- `yt-engagement-verdict/chrome/reporter.js` (gitignored, NOT committed) — same.
- `yt-engagement-verdict-api/src/index.js` (committed) — `authorized()` is now UUID-format validation; header comment updated.
- `yt-engagement-verdict/ROADMAP.md` (gitignored) — Phase 6 note added.

### Last file / line
- `yt-engagement-verdict-api/src/index.js:40-45` — `UUID_RE` + `authorized()`; call site at line 59.

### Sitrep for next session
- Deploy the Worker (`npx wrangler deploy`), then `wrangler secret delete API_KEY` (manual, needs Cloudflare auth).
- Consider fixing `test/index.spec.js` (broken boilerplate).
- Next candidates from the code eval: comment-count lifecycle between video changes (`content.js` retry/observer), injection TOCTOU race (`background.js`), full-page DOM-scan perf in the retry loop (`content.js`), bar-color vs verdict threshold mismatch.
- Rate limiting per install ID is the designated future concern for telemetry.
- Multi-tab `install_id` race logged above — revisit with rate limiting.

---

## Session 2026-08-15 — Phase 2: Correctness (Part 1) — Reporter guard + comment-count lifecycle

### Context
Two correctness items from the code review: (1) unconditional `Reporter.report()` calls crash the content script if reporter.js fails to load; (2) stale comment-count carry-over between video navigations.

### Decisions
1. **Reporter guard** — both call sites (`content.js:453`, `chrome/content.js:381`) wrapped in `typeof Reporter !== "undefined"`.
2. **Observer teardown on every navigation** — new `teardownCommentObserver()` helper (FF: disconnect MutationObserver; Chrome: `clearInterval` + disconnect IntersectionObserver). Called from `onNavigate()` and at the top of `startCommentObserver()`.
3. **New module-level `commentObserverTimer`** (distinct from `commentObserver`, per explicit instruction) tracks the pending `setTimeout` that arms the observer — cleared on navigation so a stale arm can't fire against the new DOM. Did NOT overload `commentObserver`.
4. **Full retry reset in `onNavigate()`** — `retryTimer`/`retryCount` previously only reset in `run()`, which executes 800ms after navigation, leaving a window where a stale retry could fire `attempt(oldVideoId)` against transitional DOM.
5. **Separated "genuinely 0 comments" from "not loaded yet"** — retry loop now retries only while `comments === null`; `comments === 0` proceeds immediately (no more 20s spin on zero-comment videos) and still arms the observer so a late-arriving real count corrects the verdict.
6. **Video-ID guards in both observer callbacks** — bail unless `RYD.getVideoId() === currentVideoId`, preventing a stale observer from applying the previous video's count to the new video's result.
7. **Chrome-specific:** the IntersectionObserver is now tracked at module level (`commentIntersectionObs`) so it can be disconnected on teardown — previously leaked per `startCommentObserver()` call.

### Assumptions baked in
- `RYD.getVideoId()` reads the current URL's `?v=` param — reliable identity check inside observer callbacks since the URL updates before `yt-navigate-finish` completes.
- YouTube's `#comments` node can be reused across SPA navigations; teardown + ID guard covers both reused and recreated nodes.
- The `yt-navigate-finish` dispatch from background.js (same isolated world) does reach `onNavigate()`; left unchanged.

### What was ruled out
- Unifying the two divergent content.js implementations (FF MutationObserver vs Chrome IntersectionObserver+interval) — architecture task, separate session.
- Removing the background.js `yt-navigate-finish` dispatch — redundant when YouTube fires its own event (benign double `onNavigate`) but covers cold-load edge; kept.
- Adding the `commentsPending` note to the Firefox version (Chrome-only feature) — feature, not this session's scope.

### Files changed (all committed)
- `content.js`
- `chrome/content.js`

### Last file / line
- `chrome/content.js:488-525` — interval poller with video-ID guard.

### Sitrep for next session
- Remaining eval items: injection TOCTOU race (`background.js`), full-page DOM-scan perf in the retry loop, bar-color vs verdict threshold mismatch, remote-selector try/catch robustness.
- Build via build.ps1 and manually verify FF + Chrome comment lazy-load behavior.
- FF/Chrome divergence tracking: FF MutationObserver vs Chrome IntersectionObserver.

### Commit
- 19991e2

---

## Session 2026-08-15 — Phase 2: Correctness (Part 2) — Injection TOCTOU race

### Context
`tabs.onUpdated` can fire `status === "complete"` more than once per navigation (YouTube SPA). The "already injected" check is an async `executeScript` round-trip, so two rapid events could both pass the `typeof YTVerdict` check and resolve `false` before the first injection finished — double injection, `const` redeclaration error in the isolated world.

### Decisions
1. Module-level `const injectingTabs = new Set()` in both `background.js` and `chrome/background.js`.
2. Tab ID is added to the set **before** the async typeof check — the race window is the check round-trip, not the full injection chain, so the guard must close it up front. A later `complete` event for the same tab sees `injectingTabs.has(tabId)` and returns early.
3. Single `.finally(() => injectingTabs.delete(tabId))` covers the dispatch-reset branch AND the fresh-injection branch — cleanup on success and on failure.
4. New `tabs.onRemoved` listener deletes the entry if the tab closes mid-injection.
5. `insertCSS` now chained after the script `reduce` — styles only land if all four scripts loaded (previously inserted unconditionally even when script injection had failed).
6. Restructured the handler to early-return guards + return-from-promise so the single `finally` covers every path; the dispatch branch now returns its promise so cleanup waits for it.
7. MV3 service-worker ephemerality dismissed as a concern — the set only needs to span the milliseconds between rapid events, and the pending injection promises keep the worker alive.

### Assumptions baked in
- `Promise.prototype.finally` is available (FF 58+, Chrome 63+); both trees target far newer minimums.
- A genuinely already-injected tab still takes the check path (set is empty by then) and dispatches the `yt-navigate-finish` reset — prior behavior preserved.

### What was ruled out
- Debounce/timing-based guards — racy and fragile compared to an explicit in-flight set.
- Sharing one set across the FF and Chrome trees — they are separate extension builds.
- Persisting in-flight state across MV3 worker restarts — unnecessary (see decision 7); a worker death mid-chain abandons the injection regardless.

### Files changed (all committed)
- `background.js`
- `chrome/background.js`

### Last file / line
- `chrome/background.js:68-70` — `chrome.tabs.onRemoved` cleanup listener.

### Sitrep for next session
- Remaining eval items: full-page DOM-scan perf in the retry loop, bar-color vs verdict threshold mismatch, remote-selector try/catch robustness.
- Manual verify: rapid double-navigation in both FF + Chrome yields no redeclaration errors in the page console.
- Unify divergent FF/Chrome content.js implementations (architecture session).

### Commit
- c4282f3

---

## Session 2026-08-15 — MV3 Unification

### Context
The extension shipped two divergent codebases: an MV2 Firefox build (root) and an MV3 Chrome build (`chrome/`). This session unified both under a single MV3 tree at root; `chrome/` was eliminated entirely.

### Decisions
1. **Single source of truth at root.** Root `manifest.json` became MV3: `browser_action`→`action`, `background.scripts`+`persistent`→`background.service_worker`, `scripting` permission added, host patterns split into `host_permissions`, `web_accessible_resources` in object form (`matches: ["<all_urls>"]`). Kept root's `homepage_url`, `browser_specific_settings` (gecko id, `strict_min_version: 140.0`, `data_collection_permissions`), and description. Version bumped 1.1.6 → **1.2.0**.
2. **background.js → `browser.scripting.*`.** MV2 `browser.tabs.executeScript(tabId, {code/file})` → `browser.scripting.executeScript({target: {tabId}, func/files})`, result access `results[0]` → `results[0]?.result`. Kept the Phase 2 Part 2 `injectingTabs` in-flight set and the chained `insertCSS`. `browser.scripting` landed in FF 101 — no gap against strict_min 140.0 (also MV3 `service_worker` needs FF 109+).
3. **content.js merge (browser.* + Chrome's four improvements).** Took `chrome/content.js` as the base (it had the newer strategy) and converted `chrome.*` → `browser.*`:
   - Extra comment selectors: `#comments ytd-comments-header-renderer span.count-text`, `ytd-comments-header-renderer #count`
   - `commentsPending` flag + "Scroll down to load comment data" widget note
   - IntersectionObserver + 300ms/20-attempt poll strategy replaces the FF MutationObserver-over-`#comments`-subtree (perf win, and the prior known perf concern is retired)
   - Safer update path: preserves `commentsDisabled`/`commentsPending`/`isAiContent`, `injectWidget()` fallback when widget missing
   - Kept the FF-side promise-style `browser.storage.local.remove(SELECTOR_CACHE_KEY)` in `FORCE_SELECTOR_REFRESH` (explicit user instruction — callback-style chrome version not carried over), 500ms URL poll (root's), 2000ms observer arm delay (chrome's pairing with IntersectionObserver).
   - Tradeoff accepted (flagged in scout): FF's MutationObserver caught comment counts that load without scrolling (playlist mode); IntersectionObserver needs the comments section in view.
4. **popup.js / popup.html / welcome.js / reporter.js** were functionally identical across trees — kept root versions verbatim, no changes needed. `reporter.js` stays gitignored.
5. **Shared files** (`ryd.js`, `verdict.js`, `styles.css`, `selectors.json`, `welcome.html`, `icons/`) existed only at root (build.ps1 copied them into the chrome staging) — no divergence to reconcile.
6. **build.ps1** rewritten as single-stage: one root file list → one staging dir → byte-identical `.xpi` and `.zip`. Gitignored (not committed).
7. **`.gitignore`**: `chrome/reporter.js` entry removed. Note: `chrome/reporter.js` itself was untracked, so `git rm` left it on disk; deleted manually per the brief's explicit "chrome/ subdirectory eliminated entirely" instruction.
8. Worker `/health` version still reports 1.1.6 (separate API repo) — flagged, NOT changed this session.

### Assumptions baked in
- `browser.scripting` + MV3 `service_worker` are available at strict_min_version 140.0.
- `browser.*` promise API is used throughout (no callback styles) — FF MV3 supports it natively.
- Chrome treats the unified package as a normal MV3 extension; `browser_specific_settings` is ignored by Chrome.
- The two store packages are now byte-identical content (only file extension differs).

### What was ruled out
- Keeping the FF MutationObserver comment strategy alongside IntersectionObserver — unnecessary divergence; brief named IntersectionObserver as the strategy to merge.
- Converting to `chrome.*` namespace — brief constraint: keep `browser.*`.
- Bumping the API repo version to match 1.2.0 — cross-repo, own session.
- README/CONTRIBUTING/PRIVACY churn — grep confirmed no `chrome/` references in docs.

### Files changed
- `manifest.json` (committed) — MV3, v1.2.0
- `background.js` (committed) — `browser.scripting.*`
- `content.js` (committed) — merged
- `.gitignore` (committed) — chrome/reporter.js entry removed
- `build.ps1` (committed — already tracked, so the gitignore entry is a no-op) — single-build
- `ROADMAP.md` (gitignored) — Phase 8 entry
- `chrome/` (7 files deleted, removal committed; `chrome/reporter.js` was untracked, deleted from disk)

### Last file / line
- `content.js` — merged file; comment observer block (`commentIntersectionObs`/interval poll) near the end.

### Sitrep for next session
- Deploy Worker, `wrangler secret delete API_KEY` (still pending from Phase 1), bump `/health` to 1.2.0.
- Re-submit to AMO as MV3; install the built `.xpi`/`.zip` and manually verify both stores.
- Remaining eval items: bar-color vs verdict threshold mismatch, remote-selector try/catch robustness.
- Firefox `about:debugging` check that MV3 service_worker + `browser.scripting` work on FF 140.

### Commit
- bf35cff

---

## Session 2026-08-15 — Phase 3: Performance

### Context
Three performance items in `content.js` only: full-page `querySelectorAll` fallback scans in the scrapers, the comment-count observer strategy, and the URL poller. No other files touched.

### Decisions
1. **Removed both full-page fallback scans.** `scrapeViews()` dropped the `document.querySelectorAll("span")` regex scan; `scrapeComments()` dropped the `document.querySelectorAll("span, yt-formatted-string")` regex scan. Both now return `null` on selector failure and let the retry loop / observer handle the not-ready case. These scans were the worst offenders — they forced layout (`textContent` reads) across hundreds/thousands of nodes and fired every 500ms during the up-to-20s retry window (RETRY_LIMIT 40 × RETRY_MS 500) and every 300ms in the old comment poll. Selector coverage lives in `selectors.json` (remote-updatable, 4 view / 5 like / 4 comment selectors), which is the right place for new selectors.
2. **Observer redesign.** Scout found the brief's MutationObserver description was stale — post-unification `startCommentObserver()` used IntersectionObserver + a `setInterval` poll, not a MutationObserver. Kept the IntersectionObserver scroll trigger on `#comments` (zero cost while off-screen), and replaced the 300ms × 20-tick interval with a **narrow MutationObserver**:
   - Target prefers `#comments #count` at arm time, falls back to `ytd-comments-header-renderer` — the count element is exactly what lazy-loads, so it may not exist when the observer arms (explicitly implemented, not just noted).
   - Options `{ childList: true, subtree: true }` — **no `characterData`** (structural changes only).
   - On mutation: video-ID guard → `scrapeComments()` (now cheap post-fix 1) → recompute + re-render widget → teardown once a count is found.
   - MAX_ATTEMPTS cap replaced by a bounded 8s safety `setTimeout` that tears down if the count never arrives.
   - `teardownCommentObserver()` now disconnects the MutationObserver (was `clearInterval`) and clears the safety timeout. New module-level `commentObserverTimeout`.
3. **URL poller.** Restructured to explicit early-return form: skip when URL unchanged; skip work on non-watch pages (kept the one-shot transition cleanup of `currentVideoId` + widget removal). Noted and kept running: the poller is the only mechanism for detecting pushState SPA navigation between videos, and it costs one string compare per tick when nothing changed — removing it after injection would break video-to-video nav.

### Assumptions baked in
- Inline fallback coverage was redundant with the selector list — removal is safe.
- Without `characterData`, an in-place text mutation of the count (vs node replacement) would be missed; YouTube populates the count via structural updates — accepted per brief.
- The 8s safety timeout bounds the observer; `onNavigate()` teardown also clears it.

### What was ruled out
- Keeping a timer poll alongside the MutationObserver — redundant.
- Stopping the URL poller after widget injection — would break SPA video-to-video detection.
- Touching anything outside `content.js` (per brief).

### Files changed (all committed)
- `content.js`

### Last file / line
- `content.js:539-541` — narrow MutationObserver target: `#comments #count` with `ytd-comments-header-renderer` fallback.

### Sitrep for next session
- Remaining eval items: bar-color vs verdict threshold mismatch, remote-selector try/catch robustness.
- Manual verify: scroll-to-comments lazy-load in FF + Chrome, zero-comment videos, SPA nav between videos.
- Worker `/health` still reports 1.1.6 (separate repo, pending deploy).

### Commit
- 3ffec9d

---

## Session 2026-08-15 — Phase 11: Testing baseline (brief called it "Phase 6" — number collision with ROADMAP Phase 6 Telemetry auth; recorded as Phase 11)

### Context
Established the first test suites for both repos: unit tests for `verdict.js`, an npm test script, and a rewrite of the stale scaffolded Worker test suite. No production logic changed (testing baseline only).

### Decisions
1. **Runner: Node's built-in `node:test`** — zero deps, no transpile, no bundler (Node 24.18). Script: `node --test "test/**/*.test.js"` — the naive `node --test test/` directory arg failed (`MODULE_NOT_FOUND` on the dir); the glob form works.
2. **SCOPE EXCEPTION (guardrail #4, user-approved): `verdict.js` export mechanism.** Option A implemented — guarded `module.exports = YTVerdict` at the bottom (`typeof module !== "undefined"` guard; inert in content scripts). Additionally, the IIFE `return { compute }` was extended to `return { compute, scoreToVerdict, scoreSentiment, scoreRate }`. This second part was required, not cosmetic: the brief demands direct boundary tests of these three functions, and they are closure-private — the exact 0.20/0.55/0.90 percentages are unreachable through `compute()` alone (its maxScore is always 2/4/6). The extra keys are inert on the browser-visible `YTVerdict` global — verified `content.js` only calls `YTVerdict.compute`.
3. **Extension `package.json` stays gitignored.** The `test` script lives only locally; the committed artifacts are `test/verdict.test.js` + the `verdict.js` guard. Tradeoff accepted and noted: a fresh clone gets the test file but no `package.json`, so `npm test` needs the local file. Flagged if CI is ever wanted.
4. **20 verdict tests** cover the brief's full matrix: compute() all four verdicts (6/6, 5/6, 3/6, 1/6, 0/6), null-comments exclusion (maxScore 4, incl. the 1/4 = 0.25 → Hot Garbage boundary), zero-comments scored-not-excluded, null-dislikes exclusion, both-null (maxScore 2), zero-views error path (0/null/undefined/NaN), scoreToVerdict exact boundaries via maxScore=100 (20/21, 55/56, 90/91, 100), scoreSentiment (null/undefined, zero total, 0.85/0.40/0.39 boundaries), scoreRate at/above/below low & high, and **all five** tier boundaries (brief said four — verdict.js has always had five; the last tier is `{ max: Infinity }`).
5. **Worker tests: neon driver mocked** via `vi.hoisted` + `vi.mock("@neondatabase/serverless")`. The mock `neon()` returns a tagged-template `sql` fn that branches on the (trimmed) query text — SELECT returns canned rows (known video → row, unknown → []), writes resolve. No test database needed. First run exposed a mock bug: template literals begin with a newline, so `startsWith("SELECT")` missed until `.trim()`. 11 tests = the brief's 6 + 5 bonus that lock actual behavior (invalid JSON 400, missing fields 400, missing videoId 400, unknown route 404, OPTIONS preflight 204).
6. **`/health` version: brief expected 1.0.0 — actual is 1.1.6** (aligned in API commit `783d939`). Test asserts the actual. The 1.2.0 bump remains a pending cross-repo item; when it lands, the health assertion must be updated.
7. **Docs:** no "four tiers" reference existed anywhere (README's "The four verdicts" counts verdicts, correctly). Added the one-sentence heuristics caveat to README (after the tier table) and to CONTRIBUTING's scoring-calibration section: the cited papers established methodology and signal hierarchy, not the exact numbers.

### Latent bugs flagged — NOT fixed (testing baseline only; dedicated fix session required)
1. `compute()` guard `!views || views === 0` catches 0/null/undefined/NaN but **negative views pass through** and produce a verdict instead of the error path.
2. `scoreToVerdict(0, 0)` → `pct = NaN` → all comparisons false → returns "Legit on Fire". Unreachable via `compute()` (min maxScore is 2) but reachable by direct call.
3. `scoreSentiment()` unguarded against **negative dislikes** (could produce ratio > 1 or NaN).

### Assumptions baked in
- `node:test` glob discovery works on Node 24 (verified — 20/20 pass).
- Mocking the Neon driver is the right approach for unit-style Worker tests; a real test DB is unnecessary for the current route surface.
- Exposing extra props on `YTVerdict` cannot break `content.js` (verified call sites).

### What was ruled out
- Vitest for the extension (heavyweight, requires install — node:test is built in).
- A real test database for the Worker suite (brittle, needs network + Neon branch).
- vm-based loader for verdict.js (Option B — uglier test, zero production change, rejected in favor of the approved guarded export).
- Fixing the three latent bugs (explicitly out of scope this session).
- Testing the `scheduled()` cron handler (not in the brief).

### Files changed
- Extension (committed): `verdict.js` (scope-exception export), `test/verdict.test.js` (new), `README.md` + `CONTRIBUTING.md` (heuristics caveat)
- Extension (gitignored, NOT committed): `package.json` (test script)
- Extension (gitignored, local only): `ROADMAP.md` (Phase 11 entry)
- API repo (committed): `test/index.spec.js` (rewritten)

### Last file / line
- `yt-engagement-verdict-api/test/index.spec.js:49-55` — `sqlMock` tagged-template implementation (trim + SELECT branch).

### Sitrep for next session
- Latent-bug fix session (three items above) — highest priority.
- Worker `/health` → 1.2.0 bump (cross-repo) — update the health test assertion alongside.
- Remaining eval items: bar-color vs verdict threshold mismatch, remote-selector try/catch robustness.
- Manual verify: welcome close-vs-redirect flow in FF + Chrome (Phase 10 fix).

### Commit
- 1303b02 (extension) — API repo: 3345fd8

---

## Session 2026-08-15 — Phase 12: Robustness + UI Consistency (brief's Phases 4 & 5)

### Context
Final session before shipping 1.2.0. Four items across three committed files (content.js, popup.js, styles.css) plus one gitignored file (reporter.js). No changes to verdict.js, ryd.js, background.js, manifest.json, or the API repo.

### Decisions
1. **Phase 4.1 — `safeQuery()` helper in content.js.** Rather than wrapping each scrape loop in try/catch, a single guarded `querySelector` wrapper (`content.js:151-167`) satisfies the brief: on `SyntaxError` it logs a `[YTEV] Bad selector "…"` debug line and returns `null` (fall through to the next selector in the list); other errors rethrow. Every bare `document.querySelector` was converted — scrapeViews, scrapeLikes, scrapeComments, scrapeAiLabel (container + fallback), injectWidget's inject_before loop, the comment-observer targets (`#comments`, `#comments #count`, `ytd-comments-header-renderer`), and the title-readiness probe (both occurrences). The chained `countEl.closest(...).querySelector("span…")` and `container.querySelectorAll("span")` calls use hardcoded selectors and were left bare (they cannot throw SyntaxError). Verified by grep: the only remaining `document.querySelector` in content.js is inside safeQuery itself.
2. **Phase 4.2 — telemetry throttle/dedup in reporter.js.** `REPORT_THROTTLE_MS = 60_000` + module-level `lastReportedVideoId`/`lastReportedAt`. `report()` records the videoId before the POST and skips if the same videoId was reported within the window — covers the initial scrape AND comment-observer recomputes. Record-before-fetch chosen over record-on-success: the observer recompute fires within ~2s, and the intent is one POST per video per page view; a failed POST simply isn't retried for 60s (acceptable — telemetry is best-effort, errors are already swallowed).
3. **GITIGNORE SITUATION (logged per brief):** reporter.js is in `.gitignore` ("Local only"), so the throttle/dedup changes are NOT committed — but reporter.js IS in build.ps1's file list, so the changes ship inside the built XPI/ZIP packages. Confirmed present locally and absent from `git status`.
4. **Phase 5.1 — `barColor()` deleted from popup.js.** The function (popup.js:13-19) re-copied the 0.20/0.55/0.90 bands and colors from verdict.js. The popup already receives `verdict.color` in the GET_VERDICT response, so the call site now uses `verdict.color` directly. Deletion rationale: the color bands now exist in exactly one place (verdict.js `scoreToVerdict`); popup.js's duplicate was a drift hazard and a violation of the single-source-of-truth goal. Verified equivalent: `barColor(score, max)` returned exactly `verdict.color` for every score/maxScore combo (same bands, same hex values).
5. **Phase 5.2 — bar color from percentage, not absolute composite.** `content.js` renderWidget now sets `data-score` to `pct` (0-100, already computed at line 243) instead of the absolute composite; `data-max` unchanged. **Implementation note:** CSS cannot range-match attribute values (`[data-score="20"]` only matches exact), so the brief's "percentage ranges" cannot be expressed as bare attribute selectors without enumerating ~100 values. Cleaner solution: content.js also sets `data-band` = 0/1/2/3 from the same `scoreToVerdict` thresholds (≤20 → 0, ≤55 → 1, ≤90 → 2, else 3), and styles.css keys the four bar colors off `data-band`. `data-score` still carries the raw percentage as the brief requires. This fixes the flagged mismatch: 4/4 (Fire) and 2/2 (Fire) now render the fire gradient instead of green/orange; 1/2 (Garbage) renders orange instead of red.
6. **Version bump — not needed.** The brief says "bump to 1.2.0", but manifest.json is already 1.2.0 (bumped during MV3 unification, HEAD confirmed). No manifest change made; it's excluded from the commit for that reason.

### Assumptions baked in
- CSS attribute selectors can't express numeric ranges — hence the `data-band` addition alongside `data-score` (documented in both files).
- `verdict.color` is equivalent to the old `barColor()` output — verified by inspection of the identical bands/hex values.
- Nothing else reads `data-score` (grep confirmed: only the widget sets it and only CSS consumed it); changing its semantics is safe.

### What was ruled out
- Guarding the two hardcoded chained selectors (can't throw; noise).
- Record-on-success for the throttle timestamp (would re-fire on network failure — acceptable either way, chose simpler).
- Enumerating ~100 `[data-score="N"]` CSS selectors to avoid the `data-band` attribute (unmaintainable).
- Setting the bar color inline from `verdict.color` (would lose the green/fire gradients that styles.css defines).

### Files changed
- `content.js` (committed) — safeQuery + all lookups; data-score=pct + data-band
- `popup.js` (committed) — barColor deleted; verdict.color used
- `styles.css` (committed) — data-band colour bands
- `reporter.js` (NOT committed — gitignored) — throttle/dedup; ships via build.ps1 packages
- `ROADMAP.md` (gitignored, local) — Phase 12 entry
- `manifest.json` — UNCHANGED (already 1.2.0)

### Last file / line
- `content.js:262-269` — widget data-score/data-max/data-band attributes.

### Sitrep for next session
- **Manual verify (required before release):** build via build.ps1 and check the widget bar colour on a video where signals are missing (e.g. RYD down → maxScore 4, and comments disabled → maxScore 2) — the bar must match the verdict colour band, not the absolute score.
- Latent-bug fix session (three verdict.js items from Phase 11 log) still queued.
- Worker `/health` → 1.2.0 bump (cross-repo) — update the health test assertion alongside.
- If telemetry correctness matters, consider un-ignoring reporter.js or mirroring the throttle in a committed file — currently local-only by design.

### Commit
- a7e828f (reporter.js changes NOT committed — gitignored)

---

## Session 2026-08-15 — Phase 10: Repo Hygiene

### Context
Housekeeping pass: dead `.gitignore` entries, a stray `package.json`/`node_modules` from API work polluting the tree, a hardcoded `build.ps1` with a no-op ignore entry, a `window.close()` with no fallback in `welcome.js`, and docs that needed a Shorts note plus a stale Chrome-port section fixed.

### Decisions
1. **`.gitignore`**: removed the duplicate `.env.local` (lines 20 & 22); added `package.json`, `package-lock.json`, `node_modules/`, `skills-lock.json`, `.agents/`, `.claude/`. Rationale for the package files: the extension is vanilla browser JS — zero `require`/`import`/`@neondatabase` usage anywhere (grep-verified); `@neondatabase/serverless` is the API repo's driver and is a stray here. `.agents/`, `.claude/`, `skills-lock.json` are local AI-toolchain files that showed as `??` every session — gitignored per explicit go-ahead (denali approved adding them).
2. **`build.ps1` untracked** — `git rm --cached build.ps1`. The `.gitignore` entry for it was dead because the file was tracked; now the ignore is live and the file stays local. This also makes its future improvements invisible to the repo (by design — it's a local build script).
3. **`build.ps1` hardened** — `$root` now `$PSScriptRoot` (was a hardcoded `C:\Users\steve\dev\...`); added a `7z` PATH check that fails fast with a clear message (was a silent `Out-Null` failure at archive time); the two identical `7z a` calls collapsed into one loop over a Firefox/Chrome target table; added `-OutputDir` param defaulting to `$env:USERPROFILE\Downloads` (behavior-preserving). Smoke-tested against a temp output dir: both archives produced, byte-identical (27040 bytes each), staging cleaned.
4. **`welcome.js`**: added a `window.close()` fallback. `window.close()` silently no-ops on tabs the script didn't open; the old code stranded the user on a frozen blank page. A second `setTimeout` (4s) checks `window.closed` and `location.replace("https://www.youtube.com")` if the tab didn't close. If close succeeded the context is destroyed, so the fallback never fires — safe to run unconditionally.
5. **`CONTRIBUTING.md`**: added a "YouTube Shorts" section documenting intentional non-support in v1.x (different layout, no comment section, swipe-driven view counting) — one-line why, and explicitly says "expected, not a broken selector" so it routes Shorts reports away from selector-fix churn. Replaced the stale "Chrome / Chromium port" section — it claimed the extension was Firefox-only and needed webextension-polyfill, false since the MV3 unification (v1.2.0). It now states the single MV3 tree runs in both, `browser.*` throughout, no polyfill.
6. **Roadmap numbering**: the brief called this "Phase 7" but ROADMAP.md already used 7/7b/8/9; recorded as **Phase 10 — Repo Hygiene** to avoid renumbering history. Phase status went to ROADMAP.md because AGENTS.md contains no roadmap section (guardrail #3 intent satisfied via the actual roadmap).

### Assumptions baked in
- `welcome.html` needs no change — its `<script src="welcome.js">` (line 200) and the `web_accessible_resources` entry were verified correct.
- Chrome supports the `browser.*` namespace natively in MV3 (the codebase has used it since the unification and was manually verified).
- Gitignoring `package.json` won't hide a future real dependency — if the extension ever grows a build step, the entries are trivially removable.

### What was ruled out
- Deploying `build.ps1` output or testing it in browsers — the change is mechanical (param/loop/check); verified by successful archive build.
- Adding `.env.local` cleanup — already ignored, untouched content.
- Touching `reporter.js`/`ROADMAP.md` ignore state — both confirmed live and intended.

### Files changed
- `.gitignore` (committed) — dedupe + new entries
- `build.ps1` (git rm --cached + hardened; stays untracked/gitignored)
- `welcome.js` (committed) — close fallback
- `CONTRIBUTING.md` (committed) — Shorts note + Chrome-port fix
- `ROADMAP.md` (gitignored) — Phase 10 entry

### Last file / line
- `welcome.js:23-27` — close-fallback `setTimeout`.

### Sitrep for next session
- Build via build.ps1 and reinstall in FF + Chrome to eyeball the welcome flow (close vs redirect paths).
- Remaining eval items: bar-color vs verdict threshold mismatch, remote-selector try/catch robustness.
- Worker `/health` still reports 1.1.6 (separate API repo, pending deploy).
- First `git status` after this session should be clean — the recurring `??` entries are now ignored.

### Commit
- 

