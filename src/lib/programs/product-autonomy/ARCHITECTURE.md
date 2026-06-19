# Product Autonomy — Wizard Program Architecture

How the `product-autonomy` program works: the program that runs on `npx @posthog/wizard
self-driving` and sets up **PostHog Signals** for a project. It spans **three repos**; the
load-bearing idea is the **division of labor** (§1) — the wizard owns *order + mechanics +
URLs*, context-mill owns *how each step is done*, posthog owns *the backend and the gating*.

> [!IMPORTANT]
> **Keep this doc in lockstep with the code.** If you change anything in this scope — a step,
> the prompt, an OAuth scope, a feature flag, an MCP tool the agent calls, a skill reference,
> the scout/source models, or the gating — update this file in the same change. The most
> drift-prone parts are the **OAuth scopes (§3 / §7)** and the **gating (§6)**.

Branches this was written against — `wizard: feat/product-autonomy`, `context-mill:
feat/product-autonomy-setup-skill`, `posthog: feat/signals-scout-config-sync`. Paths with no
prefix are in `wizard`; cross-repo paths are prefixed `posthog/…` / `context-mill/…`.
`file:line` anchors are point-in-time — the symbol names are the durable part.

### Where to look

| Need | Go to |
|---|---|
| The ordered steps | `src/lib/programs/product-autonomy/prompt.ts` |
| What each step *does* | `context-mill/context/skills/product-autonomy/references/*.md` |
| Program registration / lifecycle | `src/lib/programs/product-autonomy/index.ts` |
| `wizard_ask` / `.env` tools | `src/lib/wizard-tools.ts`, `src/lib/wizard-ask-bridge.ts` |
| OAuth scopes (+ prod ceiling) | `src/lib/oauth/program-scopes.ts` (§3, §7) |
| Signals models / MCP / sync | `posthog/products/signals/backend/…` (§5) |
| Why a team gets no findings | §6 |
| What to change for prod | §7 |
| Local dev + reset | §8 |

---

## 1. Division of labor

- **`wizard` (machinery).** The runner, agent loop, TUI, `wizard-tools` MCP server, OAuth, and
  YARA hooks know nothing about Signals. The only Signals-specific code here is the program's
  **prompt** (`prompt.ts` — the *order* + mechanics), its **config/lifecycle** (`index.ts`),
  its **abort vocabulary** (`detect.ts`), and its **OAuth scope additions** (`program-scopes.ts`).
- **`context-mill` (the HOW).** The installed `product-autonomy-setup` skill is the source of
  truth for *how* each step runs — tools, recipes, verification. The wizard ships only the skill
  **ID**; the body is fetched at runtime and can change independently of the wizard release.
- **`posthog` (backend + gating).** The models the agent writes (`SignalSourceConfig`,
  `SignalScoutConfig`, custom `LLMSkill` scouts), the MCP tools, the on-demand fleet `sync`
  endpoint, the canonical scouts, and the gating (two flags, AI consent, GitHub) that decides
  whether anything runs.

The program `requires: ['posthog-integration']` — the base SDK-integration program must have run
first, proven by `posthog-setup-report.md` existing in the install dir (checked in `detect.ts`).

---

## 2. The run (9 steps)

The agent makes its 9-item task list up front (one `TaskCreate`), drives it with `TaskUpdate`,
and asks the user only via `wizard_ask` (batched). Each prompt STEP names a skill reference whose
matching context-mill file carries the HOW.

**Step backbone (expected action, one line each):**

1. **Check access** — probe the Signals API; if it's not available for the team, abort cleanly (`[ABORT] product autonomy is not available for this project`).
2. **Read context** — build an evidence picture of which products are in use (setup report + `signals-scout-project-profile-get` + cheap usage probes + a light repo scan); read-only.
3. **AI approval** — no-op: org consent is enforced upstream, so just record "approved".
4. **Connect GitHub** — required; if no `github` integration, send the user through the GitHub App install (one-click authorize deep-link) and re-verify; abort if declined.
5. **Enable sources** — always enable the scout gate; enable native sources (error tracking, replay, support) only where step-2 evidence shows the product is in use.
6. **Offer issue trackers** — one multi-select (GitHub Issues / Linear / Zendesk / pganalyze). Auto-connect what the run can: GitHub Issues (pick a repo) and Linear (one-click OAuth link → single silent `integrations-list` check → create, never nudge). Zendesk / pganalyze need credentials the run never collects, so they're armed as dormant responders + a report follow-up — no UI redirect, no verification (a downstream reminder prompts the user to finish). Enable a (possibly dormant) responder for every pick.
7. **Configure scout fleet** — materialize the canonical fleet; keep the universal scouts, enable conditional ones only with evidence, disable the rest.
8. **Design custom scouts** — gap-analyze the repo against the fleet, propose candidates in one ask, create the approved subset (the only place custom scouts are made).
9. **Write report** — write `./posthog-self-driving-report.md` (everything changed + follow-ups); findings reach the inbox in ~30 min.

The table below adds the skill reference and the tool/MCP surface for each.

| # | Step | Skill ref / file | Tools · surface |
|---|---|---|---|
| 1 | Check access | `1-check-access.md` | Probe `inbox-source-configs-list` (no readable beta flag — the API *is* the probe). Fail → `[ABORT] product autonomy is not available for this project`. |
| 2 | Read project & Signals state | `2-read-context.md` | `./posthog-setup-report.md` + `signals-scout-project-profile-get` + cheap usage probes. Prompt opt-ins are authoritative ("repo evidence rules a product IN, never OUT"). |
| 3 | Confirm AI data processing approval | `3-ai-approval.md` | Now a near no-op: org consent is enforced **upstream** by the base wizard's AI opt-in gate (§6), so it's guaranteed granted here — the agent just records "approved"; no `wizard_ask`, no abort. |
| 4 | Connect GitHub (REQUIRED) | `4-github.md` | `integrations-list` for `kind:"github"`; else `wizard_ask` → `/settings/environment-integrations`, re-verify. Can't → `[ABORT] github connection declined`. |
| 5 | Enable signal sources | `5-sources.md` | Create/enable `SignalSourceConfig` rows for products in use (`inbox-source-configs-*`). Always enables the scout gate `signals_scout`/`cross_source_issue`. Never enables an unconfirmed tool. |
| 6 | Offer issue-tracker integrations | `6-connected-tools.md` (+ `6a`, `6b`) | One batched multi-select for GitHub Issues / Linear / Zendesk / pganalyze. GitHub Issues & Linear auto-connect via `external-data-sources-create` (Linear: OAuth link + one silent `integrations-list`, never nudge); Zendesk / pganalyze are armed dormant + report follow-up (no UI redirect, no verify). Enable a (possibly dormant) responder per pick. |
| 7 | Configure the scout fleet | `7-scouts.md` | `signals-scout-config-sync` materializes the fleet (~19 scouts, grows over time); classify each row the sync returns — keep the cross-product scouts, enable surface-specific ones only with evidence, disable the rest (`signals-scout-config-update {enabled:false}`). Never touches `emit`/`run_interval`. |
| 8 | Design custom scouts | `7b-tailor-scouts.md` | The **only** place custom scouts are created. Gap-analyze repo surfaces vs the fleet; propose in ONE `wizard_ask`; create approved ones via `llma-skill-create` (`signals-scout-<scope>`). **Canonical bodies never edited.** Declining is valid, not an abort. |
| 9 | Write report & hand off | `8-report.md` | Write `./posthog-self-driving-report.md`; findings appear in the inbox in ~30 min. |

**Abort contract:** the skill emits exact `[ABORT] <reason>` strings; the wizard matches them
against `PRODUCT_AUTONOMY_ABORT_CASES` (`detect.ts`) for tailored error outros. The reason strings
are a cross-repo contract — change one, change both repos.

---

## 3. Wizard internals

**Program definition** (`src/lib/programs/product-autonomy/`, five files):
`index.ts` (config + lifecycle), `prompt.ts` (the 9 steps + mechanics + project URLs),
`detect.ts` (prerequisite check + abort vocabulary), `steps.ts` (TUI screen sequence
`detect → intro → health-check → auth → run → outro`), and `content/tips.ts` (the
program-owned `Tips`-sidebar copy that defines signal sources + scouts in plain
language, wired via `getTips`; `RunScreen` falls back to `DEFAULT_TIPS` for every
other program, so nothing else is affected). `productAutonomyConfig` is built from the
`createSkillProgram` factory (`src/lib/programs/agent-skill/`) with overrides. Notables in
`index.ts`: `PRODUCT_AUTONOMY_SKILL_ID = 'product-autonomy-setup'`, `REPORT_FILE =
'posthog-self-driving-report.md'`, `maxQuestions: 13` (AI approval + GitHub + tracker picks +
custom-scout proposal), `richLinks: true` (OSC-8 links so long OAuth URLs survive wrapping), and
`postRun` (just `removeInstalledSkill` — the setup skill is transient,
marker-guarded by `.posthog-wizard`, so there's no keep-skills step). The outro inbox URL is the
clean `…/project/:id/inbox` built in `buildOutroData` (no auth deep-link — §7 item 7). CLI:
`src/commands/autonomy.ts`;
`--install-dir` becomes `session.installDir` (the agent's working dir and detection target).

**Runner & agent loop (generic — not Signals-aware).** `runProgram` (`src/lib/agent/agent-runner.ts`)
is the fixed pipeline `init → health → settings → OAuth → skill install → agent → run → errors →
postRun → outro`. It installs the skill by ID, resolves the MCP URL, runs the Claude Agent SDK
`query()` (`src/lib/agent/agent-interface.ts`) in a sandbox with the `posthog-wizard` + `wizard-tools`
MCP servers, and parses agent output: `[STATUS]` → UI, `[ABORT] <reason>` → terminal
`AgentErrorType.ABORT` matched against `config.abortCases`. `PromptContext` (project/host + AI-consent
+ product opt-ins, from `/api/users/@me/` and `/api/projects/:id/`) feeds `buildProductAutonomyPrompt`.
Anything deeper here is generic machinery — read those two files directly.

**`wizard-tools` MCP + `wizard_ask`** (`src/lib/wizard-tools.ts`). `check_env_keys` / `set_env_values`
are the only sanctioned `.env` access (value-safe, `.gitignore`-guarded, secret-vault aware).
`wizard_ask` is the **only** way to ask the user anything — 1–8 questions, capped at `maxQuestions`
(13), batched. No bridge (CI/non-interactive) → returns an error telling the agent to default or emit
`[ABORT] requires-interactive-mode`. The bridge (`src/lib/wizard-ask-bridge.ts`) brokers into the TUI
overlay; cancelled/timed-out fields resolve to `CANCELLED_SENTINEL = '__cancelled__'`.

**OAuth scopes** (`src/lib/oauth/program-scopes.ts`). Base `WIZARD_OAUTH_SCOPES`
(`src/lib/constants.ts`) ∪ `PRODUCT_AUTONOMY_SCOPE_ADDITIONS` — **12 strings**, requested via a PKCE
auth-code flow:

| Scope | Why |
|---|---|
| `task:read`, `task:write` | The signal **source** config API (`inbox-source-configs-*`) is under the generic `task` scope (not a Signals-specific one). |
| `integration:read` | `integrations-list` — verify GitHub (STEP 4). |
| `signal_scout:read`, `signal_scout:write` | List/sync/tune the scout fleet (STEP 7). |
| `session_recording:read`, `survey:read`, `error_tracking:read` | Read-only usage probes (STEP 2). **Already in the prod ceiling.** |
| `external_data_source:read`, `external_data_source:write` | Create/verify warehouse sources (STEP 6). **NOT yet in the prod ceiling — see §7.** |
| `llm_skill:read`, `llm_skill:write` | Read the authoring guide + canonical bodies, create approved custom scouts (STEP 8). **NOT yet in the prod ceiling — see §7.** |

The prod `OAuthApplication.scopes` ceiling is an **exhaustive allow-list** (`posthog/scopes.py`,
`scopes_within_ceiling`) — anything outside it is rejected at `/authorize`. So **all nine net-new
scope objects must be in the prod ceiling**, not just the four the in-code comment flags (§7).

**Security & TUI.** YARA hooks (`src/lib/yara-hooks.ts`) scan Bash/Write/Edit/Read content and
installed skills via the `warlock` scanner (fail-closed; categories: prompt injection, exfiltration,
destructive ops, supply-chain, secrets, PII); a critical match aborts the run. New rules go in
`warlock`. The agent writes the report (`OutroScreen` surfaces it + a clean Self-driving inbox link
and a next-steps list — §7 item 7); progress comes from the agent's `TaskCreate`/`TaskUpdate` calls
synced to the TUI.

---

## 4. context-mill: the `product-autonomy-setup` skill

Source: `context-mill/context/skills/product-autonomy/`. `config.yaml` (`template: description.md`,
`tags: [signals, product-autonomy]`, no fetched docs), `description.md` (becomes `SKILL.md`; declares
the 9-step chain + the cross-cutting rules: trust the setup report, list-before-create idempotency,
only switch sources on, ask-then-connect, **canonical scout bodies never edited — new scouts only in
step 7b**), and the `references/` chain `1-check-access → 2-read-context → 3-ai-approval → 4-github →
5-sources → 6-connected-tools` (+ `6a-github`, `6b-linear`) `→ 7-scouts → 7b-tailor-scouts → 8-report`
(chained by `next_step` frontmatter; what each does is in the §2 table).

The canonical `signals-scout-*` skills do **not** live here — they're in posthog (§5). context-mill
ships only the orchestration skill.

**Build & consumption.** `pnpm build` renders per-skill ZIPs (`dist/skills/product-autonomy-setup.zip`)
+ a bundle + `skill-menu.json`; the dev server (`pnpm dev`, port **8765**) hot-rebuilds individual
skill zips but **not** the bundle. Release: a PR to `main` with the **`mcp-publish`** label builds and
force-moves the `latest` GitHub release tag. The wizard resolves the skill ID at runtime against
`getSkillsBaseUrl(localMcp)` (`src/lib/constants.ts`): `…/releases/latest/download` (prod) or
`localhost:8765` (`--local-mcp`) — so skill content is decoupled from the wizard npm release (and a
prod wizard is broken until the skill is published to `latest`; §7).

---

## 5. posthog: Signals / scout backend

Under `posthog/products/signals/backend/`.

**Sources.** `SignalSourceConfig` (`models.py`): one row per `(team, source_product, source_type)`,
`enabled` (default true); `is_source_enabled` gates emit (`llm_analytics` always allowed). The scout
gate the flow flips on is `signals_scout`/`cross_source_issue`. MCP: `inbox-source-configs-*` (under
the `task` scope); `-destroy` disabled. Enabling can trigger server-side side-effects (backfills,
schedules, data-import sync).

**Scout fleet.** `SignalScoutConfig` (`models.py`): per `(team, skill_name)`, `enabled` (participation),
`emit` (dry-run vs emit, default on), `run_interval_minutes` (default 60). Canonical fleet (~19 `signals-scout-*` skills, and growing) in
`posthog/products/signals/skills/`. STEP 7 does **not** hardcode the list — it classifies whatever
`signals-scout-config-sync` returns into **always-on** (cross-product: `general`,
`anomaly-detection`, `observability-gaps`, `health-checks`, `inbox-validation`) vs **surface-specific**
(enabled only with evidence: `error-tracking`, `session-replay`, `product-analytics`, `web-analytics`,
`feature-flags`, `surveys`, `revenue-analytics`, `ai-observability`, `logs`, `csp-violations`,
`experiments`, `customer-analytics`, `data-pipelines`, `replay-vision`), per `7-scouts.md`; plus the
`authoring-signals-scouts` companion (not a scout). `lazy_seed.py` mirrors the on-disk canonical skills into per-team `LLMSkill` rows:
`sync_canonical_skills` only ever touches rows stamped `metadata.seeded_by == "signals_scout_harness"`
(content-hash gated; a team-edited copy stops receiving updates); `register_missing_configs` gives each
live `signals-scout-*` skill a config ("author a skill, get a scout"). The wizard's STEP 7 calls MCP
`signals-scout-config-sync` → `POST …/signals/scout/configs/sync/` (scope `signal_scout:write`) to do
both immediately instead of waiting for the Temporal coordinator's tick.

**Custom scouts.** A scout is just an `LLMSkill` whose name starts `signals-scout-` (model:
`posthog/products/skills/backend/models/skills.py`). The agent authors them via
`llma-skill-create`/`-get`/`-list` (scope `llm_skill:*`), guided by `authoring-signals-scouts`. A custom
scout has **no `seeded_by` marker** — the single authoritative canonical-vs-custom discriminator (used by
sync, prune, and the reset command in §8).

**External data sources (issue trackers).** STEP 6 creates a warehouse source via the data_warehouse MCP
(`external-data-sources-create`, scope `external_data_source:write`), which **injects `created_via: mcp`**
(`posthog/products/data_warehouse/mcp/tools.yaml`) — the marker distinguishing autonomy-created sources
from a user's own. There's no FK between `SignalSourceConfig` and `ExternalDataSource` (the signals layer
attaches by `(team, source_type, schema_name)`), which is why the reset (§8) tears them down separately,
scoped to `created_via=MCP`.

**Emit gating.** A finding reaches the inbox only if all of `_preflight_emit_gates`
(`scout_harness/tools/emit.py`) pass: the run has a `scout_config`, the scout's `emit=True`, the org's
`is_ai_data_processing_approved`, and the `signals_scout`/`cross_source_issue` source is enabled.

---

## 6. Gating & prerequisites — "will it actually work?"

1. **UI flag `product-autonomy`** (`posthog/frontend/src/lib/constants.tsx`,
   `FEATURE_FLAGS.PRODUCT_AUTONOMY`). Frontend-only — gates the Inbox scene, nav item, and source-config
   loading. Off → the user can't *see* the inbox; the pipeline is unaffected.
2. **Scout-execution flag `signals-scout`** (`scout_coordinator.py`, `SIGNALS_SCOUT_DOGFOOD_FLAG`). The
   real server gate, read for distinct_id `internal_signals_scout_team_discovery`. Its JSON payload has
   `guaranteed_team_ids` / `skip_team_ids` (enrolled = guaranteed − skip). **Must stay 100%-on.** Fallback
   `DEFAULT_ENROLLED_TEAM_IDS = [1, 2, 148051]` applies only on `is_cloud()` or `DEBUG` (so local team 1
   is enrolled); self-hosted non-DEBUG fails closed.
3. **AI data processing approval** — `Organization.is_ai_data_processing_approved`
   (`posthog/models/organization.py`, default `True`, nullable; admin toggle at
   `/settings/organization#organization-ai-consent`). Fail-closed; without it findings are silently dropped.
   Enforced for this program by the **base wizard's AI opt-in gate** (`src/lib/programs/ai-opt-in-gate.ts`,
   `withAiOptInGate`): it injects an `ai-opt-in` step after `auth` for every program that doesn't set
   `requiresAi: false` (product-autonomy doesn't), and `store.getGate('ai-opt-in')` parks the agent until
   approval lands — so the run can't reach the agent unapproved. That's why prompt STEP 3 / `3-ai-approval.md`
   is now a no-op recording the already-guaranteed approval rather than asking or aborting.
4. **GitHub integration** (kind `"github"`, team or user level) — required, or repo selection degrades to
   `no_repo`. UI: `/settings/environment-integrations#integration-github`.

Plus the **Temporal coordinator schedule** (`signals-scout-coordinator-schedule`, workflow
`run-signals-scout-coordinator`) must be running, or no scout ever dispatches.

---

## 7. Prod-merge checklist

> [!IMPORTANT]
> Cross-repo launch actions. The OAuth-ceiling and flag items are **manual config, not deploys** —
> easiest to forget. Update this list whenever you add/rename a scope, flag, or backend surface.

1. **OAuth scope ceiling (prod-admin DB action).** The prod `OAuthApplication.scopes` allow-list is
   exhaustive (`posthog/scopes.py`), so confirm it contains **all nine net-new objects**: `task:read`,
   `task:write`, `integration:read`, `signal_scout:read`, `signal_scout:write`, `external_data_source:read`,
   `external_data_source:write`, `llm_skill:read`, `llm_skill:write`. The in-code comment explicitly flags
   `external_data_source:*` and `llm_skill:*` as not-yet-present. Edit the US prod client
   `c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM`, and the dev client
   `DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ` on `localhost:8010`.
2. **context-mill skill release.** Merge `product-autonomy-setup` to `main` with the `mcp-publish` label
   so the `latest` release contains the skill ZIP — else the prod wizard can't fetch it.
3. **posthog backend deploy** of the `feat/signals-scout-config-sync` work: the `sync` endpoint, companion
   seeding (`lazy_seed.py`), and the 10 canonical scout skills.
4. **Temporal coordinator schedule** running in prod.
5. **Flag rollout:** `signals-scout` 100%-on with target teams in `guaranteed_team_ids`; `product-autonomy`
   on for target users.
6. **Per-team runtime** (user's responsibility): org AI consent on, GitHub connected.

> [!NOTE]
> **Deferred / planned changes.** TODO-later items, tracked alongside the prod checklist
> so they aren't forgotten (each notes its own trigger, where it has one):
> 1. **Downstream reminder for dormant connected-tool sources.** STEP 6 no longer
>    redirects users to the warehouse UI or verifies Zendesk / pganalyze (and an
>    unfinished Linear) — it arms the dormant responder and records a report follow-up,
>    deferring the actual connection to a **downstream reminder** (e.g. a Slack nudge) that
>    tells the user to add the warehouse source. That reminder is **out of the wizard's
>    scope** (the CLI exits after the run), so it lands in posthog / Signals: make sure such
>    a reminder exists and picks up these armed-but-dormant sources. (Earlier this slot
>    tracked a redirect→Inbox switch and in-wizard credential collection; both are moot now
>    that STEP 6 collects no credentials and never redirects.)
> 2. **GitHub Issues / Linear sync cadence → 1h.** The MCP source-create builds the
>    schema array server-side and defaults non-CDC sources to **6h**
>    (`external_data_source.py`), so STEP 6 leaves issue syncs at 6h. To tighten the
>    `issues` schema to `1hour` (a valid `sync_frequency`), the wizard MCP must expose an
>    `external-data-schemas` update tool (or add `sync_frequency` passthrough to
>    source-create); STEP 6a/6b would then PATCH the schema after create. Deferred — 6h is
>    fine for issue trackers.
> 3. ~~**Tailor the intro subtitle.**~~ **DONE.** `IntroScreenLayout` now takes an optional
>    `subtitle` slot (defaults to the generic "We'll use AI… / .env*…" lines, so every other
>    intro is unchanged); `ProductAutonomyIntroScreen.tsx` passes a tailored first line —
>    "We'll use AI to analyze your project and set up PostHog Self-driving." — keeping the
>    verbatim ".env* file contents will not leave your machine." guarantee as line 2. The rest
>    of the user-facing copy now also uses the **Self-driving** name (item 4 landed).
> 4. ~~**Rename `autonomy` → `self-driving`.**~~ **User-facing + functional rename DONE.**
>    Product decision to drop "autonomy" / "Product Autonomy" in favour of "self-driving".
>    Internal identifiers were deliberately left as `product-autonomy` (out of scope — never
>    shown to a user):
>    - **wizard — DONE:** the CLI command (`autonomy` → `self-driving`), the program id (now
>      `self-driving`, so the `programLabel` shown in the intro/exit no longer leaks the slug
>      `product-autonomy`), the `program-scopes.ts` map key, every user-facing string (intro
>      copy, success/outro/spinner messages, `detect.ts` abort `message`/`body`, the prompt
>      header + task labels), and the report filename (`posthog-self-driving-report.md`). The
>      two user-facing "PostHog Signals" mentions (intro more-info, AI-approval abort body)
>      also became "Self-driving".
>    - **context-mill — DONE:** `config.yaml` `display_name` + `description`, the
>      `description.md` title, the `[STATUS] Checking …` line, prose name references, and the
>      report filename in `8-report.md` (kept in lockstep with the wizard's `REPORT_FILE`).
>    - **Still `product-autonomy` (internal, deferred):** the `product-autonomy/` dir +
>      `PRODUCT_AUTONOMY_*` constants + `ProductAutonomy*` files, the `src/commands/autonomy.ts`
>      filename + `autonomyCommand` var, the screen id `product-autonomy-intro`, and the
>      context-mill skill id `product-autonomy-setup` + its dir. The skill id is a
>      wizard↔context-mill contract — rename `PRODUCT_AUTONOMY_SKILL_ID` and the skill dir
>      together if you ever do it.
>    - **`[ABORT] <reason>` tokens kept verbatim** (e.g. `product autonomy is not available for
>      this project`) — they're the `detect.ts` ↔ skill match contract and are never displayed,
>      so the rename does NOT touch them. posthog is unaffected (its `signals_*` / `SignalScout*`
>      names don't carry the program name).
> 6. **Don't make the user wait ~30 min for the first scan (if avoidable).** The report/outro
>    promises findings "within ~30 minutes" because fresh scout configs only run on the next
>    Temporal coordinator tick (`signals-scout-coordinator-schedule`) — STEP 7's
>    `signals-scout-config-sync` materializes the fleet immediately but doesn't dispatch a run.
>    Explore triggering an immediate coordinator run for this team right after setup (e.g. an
>    on-demand schedule trigger exposed as an MCP tool the wizard calls in STEP 7/9), then
>    update the outro/report copy. **Partly unavoidable:** scouts still take a few minutes to
>    actually run, and warehouse-fed sources (GitHub / Linear / Zendesk issues) can't emit until
>    their first DWH sync completes (item 2) regardless of the coordinator — so an immediate
>    trigger speeds up scout findings, not source/warehouse findings. Lands in posthog (the
>    trigger) + context-mill (call it) + the wizard outro copy.
> 7. ~~**Write down a proper end message for wizard** (go to inbox, do stuff) instead of directing
>    to docs.~~ **DONE.** `buildOutroData` (`index.ts`) drops the generic `posthog.com/docs` link and
>    renders a clean **Self-driving inbox** link (`…/project/:id/inbox`, shown verbatim — no UTM, no
>    auth deep-link) plus an "In your inbox you can…" next-steps list. Both ride two new *generic*
>    `OutroData` fields — `primaryLink` (labeled link under the headline) and `nextSteps`
>    (heading + bullets) — rendered by the shared `OutroScreen`; the Signals-specific copy stays in
>    the program's `buildOutroData`, so no product knowledge leaks into the screen. The user-facing
>    inbox label is "Self-driving inbox" across the intro bullet, run-sidebar tips, and outro (ahead
>    of the full item-4 rename).
> 8. Update Inbox UI to propose to run Wizard command for autonomy
> 9. Disable scouts that replicate pipeline (error tracking/replay)

---

## 8. Local dev & reset

Run: `POSTHOG_WIZARD_DEBUG=1 NODE_ENV=development pnpm try --install-dir=<test project> autonomy
--local-mcp`. `--local-mcp` points skills at the context-mill dev server (`localhost:8765`) and MCP at
`localhost:8787`; OAuth at the local PostHog (`localhost:8010`). Local team 1 is enrolled via the DEBUG
fallback (§6).

Each run mutates state (sources, fleet, custom scouts, warehouse sources, report), so re-testing needs a
teardown. Use the dev-only posthog command (full docs in `posthog/products/signals/ARCHITECTURE.md` →
"Resetting autonomy state for local re-testing"):

```text
python manage.py reset_signals_autonomy --team-id 1 --yes --install-dir <test project>
```

It deletes the team's sources, scout fleet config, custom scouts (preserving canonical/companion via the
`seeded_by` marker), run-state, emitted findings (via `cleanup_signals`), and **soft-deletes the
autonomy-created warehouse pipelines** (scoped to `created_via=MCP`), then removes the report and cycles
the wizard log. `DEBUG`-only.

---

## Cross-references

- Wizard design discipline: repo-root `CLAUDE.md`, `.claude/skills/wizard-development/`.
- Signals backend internals + the reset command in full: `posthog/products/signals/ARCHITECTURE.md`.
- Scout authoring: `posthog/products/signals/skills/authoring-signals-scouts/SKILL.md`.
- The setup skill: `context-mill/context/skills/product-autonomy/`. Security rules: the `warlock` repo.
