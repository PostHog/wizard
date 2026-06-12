# Product Autonomy — Implementation Handoff (session 2)

> **Status:** Working/scratch doc. **Do not commit.** Successor to `PRODUCT-AUTONOMY-PLAN.md`
> (still in this directory — read it for the full background/architecture; THIS doc is what
> happened since, what's verified, and what's next). Written 2026-06-11.

## 0. Hard rules from the user (apply before anything else)

- **NEVER run `git commit` or `git push` — under any circumstances.** Report changed files +
  suggested commit message; the user always commits themselves.
- **Explain what you're doing and why before running tool batches.** The user wants to follow
  the logic, not watch silent command streams.
- Ask before writing to agent memory.
- The user's global gitignore has `lib/` (line 31), which silently drops NEW files under
  `src/lib/**` from `git add`. The repo `.gitignore` now ends with `!src/lib/` to neutralize
  this — but stay alert in other repos.

## 1. Implementation status — DONE (all code-complete, reviewed, tested)

P0–P3 of the plan are implemented across three repos:

### wizard (this repo) — branch `feat/product-autonomy`, 2 commits
1. `fix(wizard-tools)`: **wizard_ask cap bug** (pre-existing, found by adversarial review):
   `evaluateAskCap` rejected every call once `askCallCount` hit `ASK_BATCH_THRESHOLD` (3) and
   the rejected call never advanced the counter → permanent lock; any `maxQuestions > 3` was
   unreachable. Fixed: one-time adjacency nudge tracked via `askAdjacencyNudged` flag
   (`src/lib/wizard-tools.ts`), tests updated.
2. `feat(programs)`: the `product-autonomy` program (`wizard autonomy`):
   - `src/lib/programs/product-autonomy/{index,steps,detect,prompt}.ts` + test
     `src/lib/programs/__tests__/product-autonomy-detect.test.ts`
   - `src/ui/tui/screens/ProductAutonomyIntroScreen.tsx` + ScreenId/registry entries
   - `src/commands/autonomy.ts` + bin.ts registration
   - scopes: `PRODUCT_AUTONOMY_SCOPE_ADDITIONS = [task:read, task:write, integration:read,
     signal_scout:read, signal_scout:write]` in `src/lib/oauth/program-scopes.ts`
   - `requestDeepLink(token, host, opts?: {purpose, path})` tweak in `src/utils/provisioning.ts`
     (postRun mints a logged-in inbox deep link for the outro; falls back to plain URL)
   - **No keep-skills step** — postRun removes `.claude/skills/product-autonomy-setup`
     (marker-guarded). Note: only on the success path; aborts leave it behind (known minor).
   - Detect gate: `posthog-setup-report.md` must exist in installDir; custom intro renders
     typed errors. Beta-gate checks are agent-side `[ABORT]` cases (no customer-readable API
     for PostHog-internal flags — verified).
   - `pnpm build` + all 827 tests + lint green.

### context-mill — branch `feat/product-autonomy-setup-skill`, 2 commits + **1 UNCOMMITTED fix**
- Committed: skill `context/skills/product-autonomy/` (config.yaml, description.md, 8 chained
  references: check-access → read-context → ai-approval → github(mandatory) → sources →
  connected-tools → scouts → report). skillId = `product-autonomy-setup`. Verified: generates
  via the repo build; all 129 skills + 673 doc references intact; in `skill-menu.json`.
  Also committed: pnpm-10 `onlyBuiltDependencies` fix for the warlock git dep.
- **UNCOMMITTED (user to commit):** `scripts/lib/skill-generator.js` + `.gitignore` —
  `fetchDoc` retry (3×, 1s/4s backoff on network/429/5xx) + on-disk cache `.docs-cache/`
  (24h TTL, stale-fallback-with-WARN). Fixes the dev-server startup build dying on one
  transient posthog.com fetch failure (posthog.com serves the `.md` docs slowly; failures
  moved between URLs/skills across runs — network, not content). Cached rebuild: 1.8s,
  zero fetches. No skip path: unfetchable + uncached still fails loudly.

### posthog — branch `feat/signals-scout-config-sync`, 1 commit
- `POST /api/projects/:id/signals/scout/configs/sync/` on `SignalScoutConfigViewSet`
  (`required_scopes=["signal_scout:write"]` — custom @actions NEED explicit scopes).
- `register_missing_configs` moved coordinator → `scout_harness/lazy_seed.py` (web process
  must not import Temporal workflow modules); coordinator keeps thin wrapper.
- MCP tool `signals-scout-config-sync` wired in 4 places: `products/signals/mcp/tools.yaml`,
  `services/mcp/src/tools/generated/signals.ts` (+ GENERATED_TOOLS map), and both
  `services/mcp/schema/{generated-tool-definitions,tool-definitions-all}.json` (hand-written
  to match codegen patterns; next codegen run reproduces them; `services/mcp/src/generated/
  signals/api.ts` orval output NOT regenerated — known, compiles fine, CI/next codegen covers).
- 3 new tests in `test_scout_harness_api.py` (materialize, idempotent+preserves-tuned,
  read-scope 403). 118 tests green in the affected suites. ruff + services/mcp tsc clean.

### Plan deviations (deliberate, all verified against code)
- Dropped `organization:write` + `feature_flag:read` scopes — no executor exists (agent never
  holds the OAuth token; MCP has no org read/write tool; PostHog-internal flags unreadable via
  customer API). AI-approval = wizard_ask + settings link for everyone; replay-source 400 is
  the server-side reality check.
- No `[SIGNALS_URL]` marker — inbox URL built deterministically in buildOutroData/postRun.
- Added `[ABORT] requirements-incomplete` case (wizard_ask's own error texts instruct it).
- Abort strings contract (skill ⇄ `detect.ts` regexes, char-exact): `product autonomy is not
  available for this project`, `github connection declined`, `ai data processing approval
  declined`, `requires-interactive-mode`, `requirements-incomplete`.

## 2. Local e2e environment — VERIFIED WORKING

| Thing | State / how verified |
|---|---|
| posthog web `:8010`/`:8000` | healthy (`/_health` 200) |
| Temporal | server in docker (`:7233`); Django worker = HOST process; **all queues collapse to `development-task-queue` in DEBUG** — verify pollers: `curl localhost:8081/api/v1/namespaces/default/task-queues/development-task-queue?taskQueueType=TASK_QUEUE_TYPE_WORKFLOW` (1 poller ✅) |
| context-mill dev `:8765` | serves `skill-menu.json` incl. `product-autonomy-setup` ✅ |
| local MCP `:8787` | up (401 unauth = expected); user rebuilt it with the sync tool |
| LLM gateway `:3308` | live; wizard selects it via `getLlmGatewayUrlFromHost` when host=localhost |
| Org AI approval | `is_ai_data_processing_approved = t` both orgs (psql via `flox activate -- psql 'postgresql://posthog:posthog@localhost:5432/posthog'`) |
| `product-autonomy` flag | active for team 1 |
| `signals-scout` enrollment | no flag row needed — DEBUG falls back to `DEFAULT_ENROLLED_TEAM_IDS=[1,2,…]` |
| Wizard dev build | `NODE_ENV=development` → `IS_DEV` → targets localhost; `autonomy` command registered |
| Test app | `/Users/woutut/Documents/Code/playground/rhytm_tap` (FastAPI; has `.posthog/skills/integration-fastapi` from an earlier attempt; **NO `posthog-setup-report.md` yet** — integrate must complete first) |

**OAuth fix applied (local):** the local wizard OAuth app (client_id `DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ`,
seeded by hedgebox `matrix.py:1782`) had an **empty `scopes` ceiling** (row predates the seed's
fix) → `invalid_scope` at /authorize. Fixed via Django shell: set scopes =
`sorted(UNPRIVILEGED_SCOPES | {llm_gateway:read/write, wizard_session:read/write})` (178
scopes; verified covers integrate + autonomy). **Same fix needed on CLOUD before launch** —
see §5.

## 3. CURRENT BLOCKER — integrate run exits 1 silently after OAuth

`NODE_ENV=development pnpm try --install-dir=…/rhytm_tap integrate --local-mcp` →
OAuth succeeds → TUI exits: dim `posthog-integration exited.` + ELIFECYCLE exit 1.
Reproduced 3×. **No error text anywhere, even with `POSTHOG_WIZARD_DEBUG=1`.**

Evidence established (don't re-derive):
- `/tmp/posthog-wizard.log`: dies right after the `Agent config: {…}` block (logged inside
  `initializeAgent`, agent-interface.ts:722). `runAgent`'s first acts are
  `logToFile('Starting agent run')` (agent-interface.ts:803) — **never appears** → the SDK
  run never started. Init's catch (`Agent initialization error:`) never logged → init returned OK.
- Between init-return and that first runAgent log: benchmark middleware (skipped),
  `assemblePrompt` (pure), `getSDKModule()` (verified imports OK from repo root),
  `spinner.start`, `getClaudeCodeExecutablePath()` (verified: resolves, no throw — but
  returns a **nonexistent** `cli.js`; harmless today since it's only logged, never passed to
  `query()` — SDK 0.3.146 has a new bun-bundle layout: `sdk.mjs`/`assistant.mjs`/
  `extractFromBunfs.js`, no `cli.js`).
- `run-wizard.ts:150-176` fatal catch prints `TUI init failed:` **only** when
  `DEBUG`/`POSTHOG_WIZARD_DEBUG` env set… user set it → still nothing.
- **Prime suspect (untested):** `startTUI` enters the **alternate screen buffer**
  (`ENTER_ALT_SCREEN`, start-tui.ts) and the exit cleanup leaves it — any `console.error`
  printed while inside the alt screen is **discarded** when the buffer is restored. So the
  error may be printed and lost.
- Secondary leads: TUI screens call bare `process.exit(1)` (e.g. PickerMenu error views);
  HealthCheckScreen behavior on blocked services unaudited — and the health check's MCP probe
  hits **cloud** `https://mcp.posthog.com/` even under `--local-mcp` (endpoints.ts:51 —
  logged `[health-checks] blocked by: mcp` at 11:24Z; the run continued anyway, so
  advisory, but it's a `--local-mcp` blind spot worth fixing).

### Next debugging step (do this first)
Re-run with **stderr redirected to a file** — alt-screen escape codes go to stdout, so a
stderr redirect preserves the swallowed error:
```bash
POSTHOG_WIZARD_DEBUG=1 NODE_ENV=development pnpm try \
  --install-dir=/Users/woutut/Documents/Code/playground/rhytm_tap \
  integrate --local-mcp 2>/tmp/wizard-stderr.txt
# after exit:
cat /tmp/wizard-stderr.txt
```
If that's empty too, instrument: add `logToFile` into the run-wizard.ts catch and into
`runProgram` between steps 6–8 (init → prompt → executeAgent), re-run, read
`/tmp/posthog-wizard.log`. Also check the phrocs panes (gateway `:3308`, MCP `:8787`) for
requests at the crash moment — zero gateway requests = died before first LLM call.
Permanent fix worth proposing afterwards: make the fatal catch always `logToFile` the error
and print it AFTER leaving the alt screen.

## 4. Remaining e2e plan (after the blocker)

1. `integrate` completes on rhytm_tap → writes `posthog-setup-report.md`.
2. Same command with `autonomy` instead of `integrate`. Expected: new intro → health → OAuth
   (consent shows the 5 extra scopes) → agent: access probe → reads report → AI-approval ask
   (answer "approved" — true in DB) → GitHub check (team 1 already has a github integration —
   user confirmed — so connect-flow + `GITHUB_APP_SLUG` caveat skipped) → sources enabled →
   tracker multi-select ("None") → `signals-scout-config-sync` → tuned fleet → report + outro.
3. Verify: `posthog-product-autonomy-report.md` in app root; responders in Inbox UI
   (`localhost:8010/project/1/inbox` → Edit sources); scout configs (`signals-scout-config-list`
   or psql); first scout runs within ~30 min (coordinator tick; worker is polling).

## 5. Launch checklist (cloud, out-of-band — NOT code)

1. **Wizard OAuth app scope ceiling on US + EU** (else `invalid_scope` at consent):
   add `task:read, task:write, integration:read, signal_scout:read, signal_scout:write` to
   `OAuthApplication.scopes` for client_ids `c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM` (US) /
   `bx2C5sZRN03TkdjraCcetvQFPGH6N2Y9vRLkcKEy` (EU). Django admin or shell; additive; safe early.
2. context-mill release (publishes `product-autonomy-setup` to GitHub Releases) once P1+ stable.
3. posthog deploy incl. MCP service (sync tool) before the scout step works on cloud.
4. Beta flags per team (`product-autonomy`, `signals-scout` payload) — Signals team, per plan.
5. If ever on the signup/provisioning path: add the 5 scopes to `WIZARD_PROVISIONING_SCOPES`
   AND backend `ALLOWED_PROVISIONING_SCOPES`.

## 6. Known cleanups (found, not fixed — propose as follow-up PRs)

- `run-wizard.ts` fatal catch: error invisible (alt-screen + env-gated print). Should always
  logToFile + print after leaving alt screen.
- Health checks ignore `--local-mcp`/`IS_DEV`: probe cloud `mcp.posthog.com` + cloud gateway.
- `getClaudeCodeExecutablePath()` stale for SDK 0.3.146 (returns nonexistent `cli.js`;
  currently log-only — either fix or remove).
- Setup skill not removed on abort/error paths (postRun only runs on success).
- posthog: `services/mcp/src/generated/signals/api.ts` needs a codegen pass (CI or
  `pnpm --filter=@posthog/mcp generate-orval-schemas && generate-tools`).

## 7. Key references

- Full architecture/background: `PRODUCT-AUTONOMY-PLAN.md` (this directory, do-not-commit).
- Branches: wizard `feat/product-autonomy`; context-mill `feat/product-autonomy-setup-skill`
  (+1 uncommitted fix); posthog `feat/signals-scout-config-sync`.
- Logs: `/tmp/posthog-wizard.log` (wizard runs), `/tmp/cm-build*.log` (context-mill builds).
- Useful one-liners: temporal pollers (see §2); psql via flox (see §2); regenerate one skill
  only: `generateSkillsByIds` (see `/tmp/pa-skill-gen.mjs` pattern from this session).
