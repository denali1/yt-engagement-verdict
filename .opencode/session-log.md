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

