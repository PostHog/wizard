# Product Autonomy — Wizard Program Architecture

How the `product-autonomy` program works: the program that runs on `npx @posthog/wizard
autonomy` and sets up **PostHog Signals** for a project. It spans **three repos**; the
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

| # | Step | Skill ref / file | Tools · surface |
|---|---|---|---|
| 1 | Check access | `1-check-access.md` | Probe `inbox-source-configs-list` (no readable beta flag — the API *is* the probe). Fail → `[ABORT] product autonomy is not available for this project`. |
| 2 | Read project & Signals state | `2-read-context.md` | `./posthog-setup-report.md` + `signals-scout-project-profile-get` + cheap usage probes. Prompt opt-ins are authoritative ("repo evidence rules a product IN, never OUT"). |
| 3 | Confirm AI data processing approval | `3-ai-approval.md` | Now a near no-op: org consent is enforced **upstream** by the base wizard's AI opt-in gate (§6), so it's guaranteed granted here — the agent just records "approved"; no `wizard_ask`, no abort. |
| 4 | Connect GitHub (REQUIRED) | `4-github.md` | `integrations-list` for `kind:"github"`; else `wizard_ask` → `/settings/environment-integrations`, re-verify. Can't → `[ABORT] github connection declined`. |
| 5 | Enable signal sources | `5-sources.md` | Create/enable `SignalSourceConfig` rows for products in use (`inbox-source-configs-*`). Always enables the scout gate `signals_scout`/`cross_source_issue`. Never enables an unconfirmed tool. |
| 6 | Offer issue-tracker integrations | `6-connected-tools.md` (+ `6a`, `6b`) | One batched multi-select for GitHub Issues / Linear / Zendesk / pganalyze, then connect-then-enable. Each needs a warehouse source (`external-data-sources-create`) first. |
| 7 | Configure the scout fleet | `7-scouts.md` | `signals-scout-config-sync` materializes the fleet; keep the 5 universal scouts, enable a conditional one only with evidence, disable the rest (`signals-scout-config-update {enabled:false}`). Never touches `emit`/`run_interval`. |
| 8 | Design custom scouts | `7b-tailor-scouts.md` | The **only** place custom scouts are created. Gap-analyze repo surfaces vs the fleet; propose in ONE `wizard_ask`; create approved ones via `llma-skill-create` (`signals-scout-<scope>`). **Canonical bodies never edited.** Declining is valid, not an abort. |
| 9 | Write report & hand off | `8-report.md` | Write `./posthog-product-autonomy-report.md`; findings appear in the inbox in ~30 min. |

**Abort contract:** the skill emits exact `[ABORT] <reason>` strings; the wizard matches them
against `PRODUCT_AUTONOMY_ABORT_CASES` (`detect.ts`) for tailored error outros. The reason strings
are a cross-repo contract — change one, change both repos.

---

## 3. Wizard internals

**Program definition** (`src/lib/programs/product-autonomy/`, four files):
`index.ts` (config + lifecycle), `prompt.ts` (the 9 steps + mechanics + project URLs),
`detect.ts` (prerequisite check + abort vocabulary), `steps.ts` (TUI screen sequence
`detect → intro → health-check → auth → run → outro`). `productAutonomyConfig` is built from the
`createSkillProgram` factory (`src/lib/programs/agent-skill/`) with overrides. Notables in
`index.ts`: `PRODUCT_AUTONOMY_SKILL_ID = 'product-autonomy-setup'`, `REPORT_FILE =
'posthog-product-autonomy-report.md'`, `maxQuestions: 13` (AI approval + GitHub + tracker picks +
custom-scout proposal), `richLinks: true` (OSC-8 links so long OAuth URLs survive wrapping), and
`postRun` (builds the inbox deep link, then `removeInstalledSkill` — the setup skill is transient,
marker-guarded by `.posthog-wizard`, so there's no keep-skills step). CLI: `src/commands/autonomy.ts`;
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
`warlock`. The agent writes the report (`OutroScreen` surfaces it + the inbox deep link); progress
comes from the agent's `TaskCreate`/`TaskUpdate` calls synced to the TUI.

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
`emit` (dry-run vs emit, default on), `run_interval_minutes` (default 60). Canonical fleet (10) in
`posthog/products/signals/skills/`: universal — `signals-scout-{general, error-tracking,
anomaly-detection, observability-gaps, health-checks}`; conditional — `signals-scout-{revenue-analytics,
surveys, ai-observability, logs, csp-violations}`; plus the `authoring-signals-scouts` companion (not a
scout). `lazy_seed.py` mirrors the on-disk canonical skills into per-team `LLMSkill` rows:
`sync_canonical_skills` only ever touches rows stamped `metadata.seeded_by == "signals_scout_harness"`
(content-hash gated; a team-edited copy stops receiving updates); `register_missing_configs` gives each
live `signals-scout-*` skill a config ("author a skill, get a scout"). The wizard's STEP 7 calls MCP
`signals-scout-config-sync` → `POST …/signals/scout/configs/sync/` (scope `signal_scout:write`) to do
both immediately instead of waiting for the Temporal coordinator's tick.

**Custom scouts.** A scout is just an `LLMSkill` whose name starts `signals-scout-` (model:
`posthog/products/ai_observability/backend/models/skills.py`). The agent authors them via
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
