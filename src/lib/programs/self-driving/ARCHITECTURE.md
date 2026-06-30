# Self-driving — Wizard Program Architecture

How the `self-driving` program works: the program that runs on `npx @posthog/wizard
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
| The ordered steps | `src/lib/programs/self-driving/prompt.ts` |
| What each step *does* | `context-mill/context/skills/self-driving/references/*.md` |
| Program registration / lifecycle | `src/lib/programs/self-driving/index.ts` |
| `wizard_ask` / `.env` tools | `src/lib/wizard-tools.ts`, `src/lib/wizard-ask-bridge.ts` |
| OAuth scopes (+ prod ceiling) | `src/lib/oauth/program-scopes.ts` (§3, §7) |
| Signals models / MCP / sync | `posthog/products/signals/backend/…` (§5) |
| Why a team gets no findings | §6 |
| What to change for prod | §7 |
| Local dev + reset | §8 |
| Proactive product enablement (planned) | §9 |

---

## 1. Division of labor

- **`wizard` (machinery).** The runner, agent loop, TUI, `wizard-tools` MCP server, OAuth, and
  YARA hooks know nothing about Signals. The only Signals-specific code here is the program's
  **prompt** (`prompt.ts` — the *order* + mechanics), its **config/lifecycle** (`index.ts`),
  its **abort vocabulary** (`detect.ts`), and its **OAuth scope additions** (`program-scopes.ts`).
- **`context-mill` (the HOW).** The installed `self-driving-setup` skill is the source of
  truth for *how* each step runs — tools, recipes, verification. The wizard ships only the skill
  **ID**; the body is fetched at runtime and can change independently of the wizard release.
- **`posthog` (backend + gating).** The models the agent writes (`SignalSourceConfig`,
  `SignalScoutConfig`, custom `LLMSkill` scouts), the MCP tools, the on-demand troop `sync`
  endpoint, the canonical scouts, and the gating (two flags, AI consent, GitHub) that decides
  whether anything runs.

The program `requires: ['posthog-integration']` — the base SDK-integration program must have run
first, proven by `posthog-setup-report.md` existing in the install dir (checked in `detect.ts`).

---

## 2. The run (8 steps)

The agent makes its 8-item task list up front (one `TaskCreate`), drives it with `TaskUpdate`,
and asks the user only via `wizard_ask` (batched). Each prompt STEP names a skill reference whose
matching context-mill file carries the HOW.

**Step backbone (expected action, one line each):**

1. **Check access** — **instant, no probe.** Self-driving is in **open beta** (available to every team), so there is no access gate to check; the step just marks itself in_progress→completed (no MCP call) so the step-tracking funnel still fires and the user gets an immediate first checkmark. `[ABORT] self-driving is not available for this project` is kept only as a safety net for a genuine Signals-API outage during the run.
2. **Read context** — build an evidence picture of which products are in use (setup report + `signals-scout-project-profile-get` + cheap usage probes + a light repo scan); read-only.
3. **Connect GitHub** — required; if no `github` integration, send the user through the GitHub App install (one-click authorize deep-link) and re-verify; abort if declined.
4. **Enable sources** — always enable the scout gate; enable native sources (error tracking, replay, support) only where step-2 evidence shows the product is in use.
5. **Offer issue trackers** — one multi-select (GitHub Issues / Linear / Zendesk / pganalyze). Auto-connect what the run can: GitHub Issues (pick a repo) and Linear (one-click OAuth link → single silent `integrations-list` check → create, never nudge). Zendesk / pganalyze need credentials the run never collects, so they're armed as dormant responders + a report follow-up — no UI redirect, no verification (a downstream reminder prompts the user to finish). Enable a (possibly dormant) responder for every pick.
6. **Configure scout troop** — materialize the canonical troop, then enable a deliberately small set: `general` (always) + the **1–2 specialists** for the products this project uses most; never `error-tracking`/`session-replay` (consumed as native sources); disable the rest. The enabled troop lands at **2–5** (general + 1–2 specialists + 0–2 custom).
7. **Design custom scouts** — gap-analyze the repo against the troop, propose **at most 2** candidates in one ask (each a plain-language `label` + a dimmed `description`, behind a leading "None — keep the built-in troop" default option), create the approved subset (the only place custom scouts are made).
8. **Write report** — write `./posthog-self-driving-report.md` (everything changed + follow-ups); findings reach the inbox in ~30 min.

The table below adds the skill reference and the tool/MCP surface for each.

| # | Step | Skill ref / file | Tools · surface |
|---|---|---|---|
| 1 | Check access | `1-check-access.md` | **No probe — instant** (open beta: available to every team). Marks the task in_progress→completed immediately, calls no MCP tool. The `[ABORT] self-driving is not available for this project` string remains a safety net for a genuine Signals-API outage during the run, not a beta gate. |
| 2 | Read project & Signals state | `2-read-context.md` | `./posthog-setup-report.md` + `signals-scout-project-profile-get` + cheap usage probes. Prompt opt-ins are authoritative ("repo evidence rules a product IN, never OUT"). |
| 3 | Connect GitHub (REQUIRED) | `3-github.md` | `integrations-list` for `kind:"github"`; else `wizard_ask` with the one-click `integrations/authorize?kind=github` deep-link (the single link covers fresh install / link-existing / re-auth — no separate settings "re-link" path), re-verify after a manual "done". Can't → `[ABORT] github connection declined`. |
| 4 | Enable signal sources | `4-sources.md` | Create/enable `SignalSourceConfig` rows for products in use (`inbox-source-configs-*`). Always enables the scout gate `signals_scout`/`cross_source_issue`. Never enables an unconfirmed tool. |
| 5 | Offer issue-tracker integrations | `5-connected-tools.md` (+ `5a`, `5b`) | One batched multi-select for GitHub Issues / Linear / Zendesk / pganalyze. GitHub Issues & Linear auto-connect via `external-data-sources-create` (Linear: OAuth link + one silent `integrations-list`, never nudge); Zendesk / pganalyze are armed dormant + report follow-up (no UI redirect, no verify). Enable a (possibly dormant) responder per pick. |
| 6 | Configure the scout troop | `6-scouts.md` | `signals-scout-config-sync` materializes the troop (~19 scouts, grows over time); enable `general` + the **1–2 specialists** for the most-used products (agent judgment over step-2 evidence), never `error-tracking`/`session-replay` (covered by native sources), fall back to one universal cross-product scout if no surface qualifies, disable all the rest (`signals-scout-config-update {enabled:false}`). Never touches `emit`/`run_interval`. |
| 7 | Design custom scouts | `6b-tailor-scouts.md` | The **only** place custom scouts are created. Gap-analyze repo surfaces vs the troop; propose **at most 2** in ONE `wizard_ask`, each option carrying a `description` (an optional `wizard_ask` option field rendered dimmed/wrapped under the label) plus a leading "None" option that's the default highlight (so an empty submit declines); create approved ones via `llma-skill-create` (`signals-scout-<scope>`). **Canonical bodies never edited.** Declining is valid, not an abort. |
| 8 | Write report & hand off | `7-report.md` | Write `./posthog-self-driving-report.md`; findings appear in the inbox in ~30 min. |

**Abort contract:** the skill emits exact `[ABORT] <reason>` strings; the wizard matches them
against `SELF_DRIVING_ABORT_CASES` (`detect.ts`) for tailored error outros. The reason strings
are a cross-repo contract — change one, change both repos.

---

## 3. Wizard internals

**Program definition** (`src/lib/programs/self-driving/`, five files):
`index.ts` (config + lifecycle), `prompt.ts` (the 8 steps + mechanics + project URLs),
`detect.ts` (prerequisite check + abort vocabulary), `steps.ts` (TUI screen sequence
`detect → intro → health-check → auth → run → outro`), and `content/tips.ts` (the
program-owned `Tips`-sidebar copy that defines signal sources + scouts in plain
language, wired via `getTips`; `RunScreen` falls back to `DEFAULT_TIPS` for every
other program, so nothing else is affected). `selfDrivingConfig` is built from the
`createSkillProgram` factory (`src/lib/programs/agent-skill/`) with overrides. Notables in
`index.ts`: `SELF_DRIVING_SKILL_ID = 'self-driving-setup'`, `REPORT_FILE =
'posthog-self-driving-report.md'`, `maxQuestions: 13` (GitHub + tracker picks +
custom-scout proposal), `richLinks: true` (OSC-8 links so long OAuth URLs survive wrapping), and
`postRun` (just `removeInstalledSkill` — the setup skill is transient,
marker-guarded by `.posthog-wizard`, so there's no keep-skills step). The outro inbox URL is the
clean `…/project/:id/inbox` built in `buildOutroData` (no auth deep-link — §7 item 7). CLI:
`src/commands/self-driving.ts`;
`--install-dir` becomes `session.installDir` (the agent's working dir and detection target).

**Runner & agent loop (generic — not Signals-aware).** `runProgram` (`src/lib/agent/agent-runner.ts`)
is the fixed pipeline `init → health → settings → OAuth → skill install → agent → run → errors →
postRun → outro`. It installs the skill by ID, resolves the MCP URL, runs the Claude Agent SDK
`query()` (`src/lib/agent/agent-interface.ts`) in a sandbox with the `posthog-wizard` + `wizard-tools`
MCP servers, and parses agent output: `[STATUS]` → UI, `[ABORT] <reason>` → terminal
`AgentErrorType.ABORT` matched against `config.abortCases`. `PromptContext` (project/host + AI-consent
+ product opt-ins, from `/api/users/@me/` and `/api/projects/:id/`) feeds `buildSelfDrivingPrompt`.
Anything deeper here is generic machinery — read those two files directly.

**`wizard-tools` MCP + `wizard_ask`** (`src/lib/wizard-tools.ts`). `check_env_keys` / `set_env_values`
are the only sanctioned `.env` access (value-safe, `.gitignore`-guarded, secret-vault aware).
`wizard_ask` is the **only** way to ask the user anything — 1–8 questions, capped at `maxQuestions`
(13), batched. Each `single`/`multi` option is `{ label, value, description? }`. `description` is
**optional and additive** (added for STEP 7): rendered dimmed and wrapped beneath the label, and **only
in the multi-select render path** (`PickerMenu` `MultiPickerMenu` + `WizardAskScreen`); when a question
omits it, every other ask renders byte-for-byte as before, so no other program is touched. A
multi-select's default focus is its first enabled option and an empty `enter` submits that focused
option — which is why a **decline option, when present, is placed first** (it becomes the safe default).
No bridge (CI/non-interactive) → returns an error telling the agent to default or emit
`[ABORT] requires-interactive-mode`. The bridge (`src/lib/wizard-ask-bridge.ts`) brokers into the TUI
overlay; cancelled/timed-out fields resolve to `CANCELLED_SENTINEL = '__cancelled__'`.

**OAuth scopes** (`src/lib/oauth/program-scopes.ts`). Base `WIZARD_OAUTH_SCOPES`
(`src/lib/constants.ts`) ∪ `SELF_DRIVING_SCOPE_ADDITIONS` — **12 strings**, requested via a PKCE
auth-code flow:

| Scope | Why |
|---|---|
| `task:read`, `task:write` | The signal **source** config API (`inbox-source-configs-*`) is under the generic `task` scope (not a Signals-specific one). |
| `integration:read` | `integrations-list` — verify GitHub (STEP 3). |
| `signal_scout:read`, `signal_scout:write` | List/sync/tune the scout troop (STEP 6). |
| `session_recording:read`, `survey:read`, `error_tracking:read` | Read-only usage probes (STEP 2). |
| `external_data_source:read`, `external_data_source:write` | Create/verify warehouse sources (STEP 5). |
| `llm_skill:read`, `llm_skill:write` | Read the authoring guide + canonical bodies, create approved custom scouts (STEP 7). |

The prod `OAuthApplication.scopes` ceiling is an **exhaustive allow-list** (`posthog/scopes.py`,
`scopes_within_ceiling`) — anything outside it is rejected at `/authorize`. Several of these
additions are **net-new** to that ceiling and must be added before any real-team launch; §7 item 1
is the authoritative list.

**Security & TUI.** YARA hooks (`src/lib/yara-hooks.ts`) scan Bash/Write/Edit/Read content and
installed skills via the `warlock` scanner (fail-closed; categories: prompt injection, exfiltration,
destructive ops, supply-chain, secrets, PII); a critical match aborts the run. New rules go in
`warlock`. The agent writes the report (`OutroScreen` surfaces it + a clean Self-driving inbox link
and a next-steps list — §7 item 7); progress comes from the agent's `TaskCreate`/`TaskUpdate` calls
synced to the TUI.

---

## 4. context-mill: the `self-driving-setup` skill

Source: `context-mill/context/skills/self-driving/`. `config.yaml` (`template: description.md`,
`tags: [signals, self-driving]`, no fetched docs), `description.md` (becomes `SKILL.md`; declares
the 8-step chain + the cross-cutting rules: trust the setup report, list-before-create idempotency,
only switch sources on, ask-then-connect, **canonical scout bodies never edited — new scouts only in
step 6b**, decline-option-first on every `wizard_ask` except the required step-3 GitHub gate), and the
`references/` chain `1-check-access → 2-read-context → 3-github →
4-sources → 5-connected-tools` (+ `5a-github`, `5b-linear`) `→ 6-scouts → 6b-tailor-scouts → 7-report`
(chained by `next_step` frontmatter; what each does is in the §2 table).

The canonical `signals-scout-*` skills do **not** live here — they're in posthog (§5). context-mill
ships only the orchestration skill.

**Build & consumption.** `pnpm build` renders per-skill ZIPs (`dist/skills/self-driving-setup.zip`)
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

**Scout troop.** `SignalScoutConfig` (`models.py`): per `(team, skill_name)`, `enabled` (participation),
`emit` (dry-run vs emit, default on), `run_interval_minutes` (default 60). Canonical troop (~19 `signals-scout-*` skills, and growing) in
`posthog/products/signals/skills/`. STEP 6 does **not** hardcode the list — it works from whatever
`signals-scout-config-sync` returns and enables a **deliberately small set**: `general` is the only
**always-on** scout; **1–2 specialists** are enabled for the products this project uses most (agent
judgment over step-2 evidence — `top_events` volume, recent activity, active config counts). The
specialist candidate pool is the rest of the troop — the surface-specific scouts (`product-analytics`,
`web-analytics`, `feature-flags`, `surveys`, `revenue-analytics`, `ai-observability`, `logs`,
`csp-violations`, `experiments`, `customer-analytics`, `data-pipelines`, `replay-vision`) plus the
cross-product `anomaly-detection`/`observability-gaps`/`health-checks`/`inbox-validation` —
**excluding** `error-tracking`/`session-replay`, which are deliberately never enabled because step 4
consumes them as native sources (a scout would duplicate that pipeline). If no surface clearly
qualifies, one universal cross-product scout (`anomaly-detection` or `health-checks`) is the fallback
so ≥1 specialist always runs. Everything else is disabled; the enabled troop caps at **2–5** (general
+ 1–2 specialists + 0–2 custom from STEP 7). Per `6-scouts.md`; plus the `authoring-signals-scouts`
companion (not a scout). `lazy_seed.py` mirrors the on-disk canonical skills into per-team `LLMSkill` rows:
`sync_canonical_skills` only ever touches rows stamped `metadata.seeded_by == "signals_scout_harness"`
(content-hash gated; a team-edited copy stops receiving updates); `register_missing_configs` gives each
live `signals-scout-*` skill a config ("author a skill, get a scout"). The wizard's STEP 6 calls MCP
`signals-scout-config-sync` → `POST …/signals/scout/configs/sync/` (scope `signal_scout:write`) to do
both immediately instead of waiting for the Temporal coordinator's tick.

**Custom scouts.** A scout is just an `LLMSkill` whose name starts `signals-scout-` (model:
`posthog/products/skills/backend/models/skills.py`). The agent authors them via
`llma-skill-create`/`-get`/`-list` (scope `llm_skill:*`), guided by `authoring-signals-scouts`. A custom
scout has **no `seeded_by` marker** — the single authoritative canonical-vs-custom discriminator (used by
sync, prune, and the reset command in §8).

**External data sources (issue trackers).** STEP 5 creates a warehouse source via the data_warehouse MCP
(`external-data-sources-create`, scope `external_data_source:write`), which **injects `created_via: mcp`**
(`posthog/products/data_warehouse/mcp/tools.yaml`) — the marker distinguishing self-driving-created sources
from a user's own. There's no FK between `SignalSourceConfig` and `ExternalDataSource` (the signals layer
attaches by `(team, source_type, schema_name)`), which is why the reset (§8) tears them down separately,
scoped to `created_via=MCP`.

**Emit gating.** A finding reaches the inbox only if all of `_preflight_emit_gates`
(`scout_harness/tools/emit.py`) pass: the run has a `scout_config`, the scout's `emit=True`, the org's
`is_ai_data_processing_approved`, and the `signals_scout`/`cross_source_issue` source is enabled.

---

## 6. Gating & prerequisites — "will it actually work?"

> [!NOTE]
> **Open beta — the wizard no longer probes access.** Self-driving is in open
> beta (available to every team), so STEP 1 dropped its `inbox-source-configs-list`
> access probe and runs instantly; the wizard surfaces no beta gate of its own.
> The PostHog-side gates below still apply **server-side** (a flag not yet at 100%
> just means findings won't surface), and the `[ABORT] self-driving is not available
> for this project` path is now only a safety net for a genuine Signals-API outage.

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
   `requiresAi: false` (self-driving doesn't), and `store.getGate('ai-opt-in')` parks the agent until
   approval lands — so the run can't reach the agent unapproved. That's why neither the prompt nor the
   skill has an AI-approval step anymore — the gate fully owns consent before the agent starts.
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
   exhaustive (`posthog/scopes.py`), so add the **eight net-new objects** self-driving needs: `task:read`,
   `task:write`, `signal_scout:read`, `signal_scout:write`, `external_data_source:read`,
   `external_data_source:write`, `llm_skill:read`, `llm_skill:write`. (Its other four additions —
   `integration:read`, `session_recording:read`, `survey:read`, `error_tracking:read` — are already in
   the ceiling.) Edit the US prod client
   `c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM`, and the dev client
   `DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ` on `localhost:8010`.
2. **context-mill skill release.** Merge `self-driving-setup` to `main` with the `mcp-publish` label
   so the `latest` release contains the skill ZIP — else the prod wizard can't fetch it. **Sequencing
   for the STEP 7 `description` field:** `6b` now emits `wizard_ask` options with a `description` (and a
   leading "None" decline option). Ship the **wizard** `description`-field change (the npm release)
   **before** this skill release. Reversed order degrades gracefully — Zod strips the unknown key (the
   option schema isn't `.strict()`), so an older wizard just drops descriptions and shows label-only —
   but wizard-first is the intended order. The decline-first reordering and the at-most-2 cap are pure
   skill changes with no wizard dependency.
3. **posthog backend deploy** of the `feat/signals-scout-config-sync` work: the `sync` endpoint, companion
   seeding (`lazy_seed.py`), and the 10 canonical scout skills.
4. **Temporal coordinator schedule** running in prod.
5. **Flag rollout (open beta = everyone):** `signals-scout` 100%-on for all teams (still the real
   server gate for dispatch); `product-autonomy` on for all users. The wizard no longer probes access
   in STEP 1, so an un-flagged team isn't turned away at setup — it just won't see findings until the
   server-side flags are on.
6. **Per-team runtime** (user's responsibility): org AI consent on, GitHub connected.

> [!NOTE]
> **Deferred / planned changes.** TODO-later items, tracked alongside the prod checklist
> so they aren't forgotten (each notes its own trigger, where it has one):
> 1. **Downstream reminder for dormant connected-tool sources.** STEP 5 no longer
>    redirects users to the warehouse UI or verifies Zendesk / pganalyze (and an
>    unfinished Linear) — it arms the dormant responder and records a report follow-up,
>    deferring the actual connection to a **downstream reminder** (e.g. a Slack nudge) that
>    tells the user to add the warehouse source. That reminder is **out of the wizard's
>    scope** (the CLI exits after the run), so it lands in posthog / Signals: make sure such
>    a reminder exists and picks up these armed-but-dormant sources. (Earlier this slot
>    tracked a redirect→Inbox switch and in-wizard credential collection; both are moot now
>    that STEP 5 collects no credentials and never redirects.)
> 2. **GitHub Issues / Linear sync cadence → 1h.** The MCP source-create builds the
>    schema array server-side and defaults non-CDC sources to **6h**
>    (`external_data_source.py`), so STEP 5 leaves issue syncs at 6h. To tighten the
>    `issues` schema to `1hour` (a valid `sync_frequency`), the wizard MCP must expose an
>    `external-data-schemas` update tool (or add `sync_frequency` passthrough to
>    source-create); STEP 5a/5b would then PATCH the schema after create. Deferred — 6h is
>    fine for issue trackers.
> 3. ~~**Tailor the intro subtitle.**~~ **DONE.** `IntroScreenLayout` now takes an optional
>    `subtitle` slot (defaults to the generic "We'll use AI… / .env*…" lines, so every other
>    intro is unchanged); `SelfDrivingIntroScreen.tsx` passes a tailored first line —
>    "We'll use AI to analyze your project and set up PostHog Self-driving." — keeping the
>    verbatim ".env* file contents will not leave your machine." guarantee as line 2. The rest
>    of the user-facing copy now also uses the **Self-driving** name (item 4 landed).
> 4. ~~**Rename `autonomy` → `self-driving`.**~~ **DONE — full rename, both repos, internals
>    included.** Product decision to drop "autonomy" / "Product Autonomy" in favour of
>    "self-driving". Carried out end-to-end:
>    - **wizard:** the CLI command (`self-driving`), the program id (`self-driving` — so the
>      `programLabel` shown in the intro/exit reads `self-driving`), the `program-scopes.ts`
>      map key, the `self-driving/` dir + `SELF_DRIVING_*` constants + `SelfDriving*` types /
>      components, `src/commands/self-driving.ts` + `selfDrivingCommand`, the screen id
>      `self-driving-intro`, every user-facing string (intro copy, success/outro/spinner
>      messages, `detect.ts` abort `message`/`body`, prompt header + task labels), and the
>      report filename (`posthog-self-driving-report.md`). The two user-facing "PostHog
>      Signals" mentions (intro more-info, AI-approval abort body) also became "Self-driving".
>    - **context-mill:** the skill dir `self-driving/` → skill id `self-driving-setup` (dir +
>      `setup` variant), `config.yaml` (`display_name` / `description` / `tags`), the
>      `description.md` title, `[STATUS]` lines, prose, and the report filename in `7-report.md`.
>      The skill id is a wizard↔context-mill contract — `SELF_DRIVING_SKILL_ID` must equal
>      `self-driving-setup`, and a prod wizard needs the renamed skill published to `latest`.
>    - **The `[ABORT]` token was renamed in lockstep** to `self-driving is not available for this
>      project` (`detect.ts` regex ↔ skill emit ↔ test).
>    - **Deliberately NOT renamed (other-repo identifiers):** the posthog UI flag
>      `product-autonomy` / `FEATURE_FLAGS.PRODUCT_AUTONOMY` (§6/§7) and the git branch names in
>      the header — posthog is unchanged.
>    - **`[ABORT] <reason>` tokens kept verbatim** (e.g. `self-driving is not available for
>      this project`) — they're the `detect.ts` ↔ skill match contract and are never displayed,
>      so the rename does NOT touch them. posthog is unaffected (its `signals_*` / `SignalScout*`
>      names don't carry the program name).
> 6. **Don't make the user wait ~30 min for the first scan (if avoidable).** The report/outro
>    promises findings "within ~30 minutes" because fresh scout configs only run on the next
>    Temporal coordinator tick (`signals-scout-coordinator-schedule`) — STEP 6's
>    `signals-scout-config-sync` materializes the troop immediately but doesn't dispatch a run.
>    Explore triggering an immediate coordinator run for this team right after setup (e.g. an
>    on-demand schedule trigger exposed as an MCP tool the wizard calls in STEP 6/8), then
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
> 8. Update Inbox UI to propose to run Wizard command for self-driving
> 9. ~~**Disable scouts that replicate pipeline (error tracking/replay).**~~ **DONE — folded into the
>     STEP 6 troop-narrowing.** The `error-tracking` and `session-replay` scouts are now disabled
>     unconditionally (step 4 consumes both as native sources, so a scout duplicates that pipeline) —
>     and step 6 was tightened beyond just this: it now enables only `general` + the 1–2 specialists
>     for the most-used products, capping the enabled troop at 2–5 (was ~12). Pure **context-mill**
>     change (`6-scouts.md`, with `2-read-context.md` gathering a usage ranking and `6b` barring custom
>     scouts from re-covering ET/replay); no wizard-code dependency (the prompt + this doc are lockstep
>     wording only), so it ships with the next `mcp-publish` skill release like the decline-first
>     reordering.
> 10. Record the demo and discuss the textx with the team.
> 11. ~~**Custom-scout proposal UX + decline-first asks.**~~ **DONE.** (a) **At most 2** custom scouts
>     proposed — a hard rule in `7b` (mirrored in §2); nothing in wizard code clamps the count, on
>     purpose (a count limit is product knowledge that belongs in the skill, not the ask infra). (b)
>     **Per-option explanation** via a new **optional, additive** `wizard_ask` option `description`
>     (wizard: `wizard-tools.ts` Zod schema, `wizard-session.ts` type, `PickerMenu.tsx`
>     `PickerOption.description` + multi-select render with an explicit width so Ink wraps,
>     `WizardAskScreen.tsx` forwarding + per-row spacing only when present) — **multi-path only, dormant
>     when unset → no other program changes**; context-mill `7b` populates it per proposed scout. (c)
>     **Decline option first on every self-driving `wizard_ask`** so it is the default highlight and an
>     accidental `enter` declines: step 7 ("None — keep the built-in troop"), step 5 ("None of these"),
>     5a ("Skip GitHub Issues" + fallback "Skip for now"), 5b ("Skip Linear"). **Exception: step 3's
>     GitHub gate** keeps the affirmative first and the decline ("I can't connect…", which aborts) last,
>     since the run can't proceed without GitHub. Enforced as a cross-cutting rule in `description.md`
>     (the agent builds every ask), so **no wizard code and no blast radius to other programs**. The
>     shared `PickerMenu` empty-submit behavior (an empty `enter` selects the focused option, not `[]`)
>     was **deliberately left unchanged**; decline-first neutralizes it for self-driving without touching
>     the primitive. **Residual:** navigating onto a non-decline row and pressing `enter` without `space`
>     still selects it (inherent to the untouched primitive; the cure is a one-line empty-`enter` → `[]`
>     change if ever wanted). **Prod-sequencing** for the `description` field is in checklist item 2.
> 12. **Run screen lingers on the generic "Learn" deck ~70s before the Self-driving "Tips" pane
>     appears.** During the run the left pane plays the generic **Learn** deck ("Welcome." → "The Wizard
>     is an agent." → "Running the `self-driving-setup` skill…") for ~70s before it flips to the program
>     **Tips** pane (the scout / source / inbox explainers from `getTips`) — even though the Tasks pane
>     and the bottom status line already show the agent working (e.g. "Reading project context", 1/9).
>     The switch is a **content-deck timer, fully decoupled from agent progress**, and the wait is
>     dominated by a hardcoded **`pause: 60000`** (60 s) on the deck's last block. **Where to look:**
>     `RunScreen` chooses `leftPane` off `store.learnCardComplete` (`LearnCard` until true, then
>     `TipsCard`) and resolves the deck via
>     `getProgramConfig(activeProgram).getContentBlocks ?? getSkillContentBlocks`; `LearnCard` wires
>     `onSequenceComplete → store.setLearnCardComplete()` (plus its own `startDelay` of 2 s);
>     `ContentSequencer.handleComplete` fires `onSequenceComplete` **only after the last block's `pause`
>     elapses**; the deck self-driving plays is the **shared factory default**
>     `agent-skill/content/index.tsx` (`getContentBlocks`, last block `pause: 60000`) — self-driving does
>     **not** override it today. **Scoping caveat (the whole reason this is a TODO, not a one-liner):**
>     that deck is inherited by *every* skill program (audit, revenue-analytics, migration, bare
>     `wizard skill <id>`), so editing `agent-skill/content/index.tsx` changes all of them. Fix
>     self-driving alone the way `getTips` already is — add a **self-driving-owned `getContentBlocks`**
>     override to `selfDrivingConfig` (`self-driving/index.ts`, right next to the `getTips` override);
>     only self-driving runs pick it up, every other program keeps the shared deck. **Do NOT** branch on
>     `activeProgram === 'self-driving'` inside `RunScreen` / `LearnCard` — product knowledge in shared
>     TUI machinery is the repo's core anti-pattern. Three behaviours the override could carry: (a) same
>     deck with a short final `pause` (~5 s) — smallest, zero shared-code edits; (b) **progress-driven**
>     flip (Tips the moment the first task/`[STATUS]` lands) via a new *generic* `ProgramConfig` predicate
>     hook the run screen consults — keeps the machinery generic, only self-driving supplies the
>     predicate; (c) **no deck** (Tips from the start) — needs a generic "empty deck ⇒ complete
>     immediately" guard in `LearnCard` / `RunScreen`, because an empty `getContentBlocks` never fires
>     `onSequenceComplete` and would otherwise hang on a blank Learn pane. UI polish — deferred.
> 13. **Proactive product enablement (replay / error tracking / support).** A new "Enable products"
>     step turns products ON (web server-flip) **before** STEP 4 enables their sources — via an
>     intent-based `products-enable` MCP tool (one narrow `product_enablement:write` scope,
>     server-owned recipes) instead of `project:write`; Support is flag-on + a report CTA. Full design,
>     decisions, telemetry, and the cross-repo work list are in **§9**.

---

## 8. Local dev & reset

Run: `POSTHOG_WIZARD_DEBUG=1 NODE_ENV=development pnpm try --install-dir=<test project> self-driving
--local-mcp`. `--local-mcp` points skills at the context-mill dev server (`localhost:8765`) and MCP at
`localhost:8787`; OAuth at the local PostHog (`localhost:8010`). Local team 1 is enrolled via the DEBUG
fallback (§6).

Each run mutates state (sources, troop, custom scouts, warehouse sources, report), so re-testing needs a
teardown. Use the dev-only posthog command (full docs in `posthog/products/signals/ARCHITECTURE.md` →
"Resetting self-driving state for local re-testing"):

```text
python manage.py reset_signals_self_driving --team-id 1 --yes --install-dir <test project>
```

It deletes the team's sources, scout troop config, custom scouts (preserving canonical/companion via the
`seeded_by` marker), run-state, emitted findings (via `cleanup_signals`), and **soft-deletes the
self-driving-created warehouse pipelines** (scoped to `created_via=MCP`), then removes the report and cycles
the wizard log. `DEBUG`-only.

---

## 9. Planned: proactive product enablement (replay / error tracking / support)

> [!IMPORTANT]
> **PLANNED — not yet implemented.** Design + cross-repo work list for a new step that turns PostHog
> products ON (so the signal sources have data to read) **before** STEP 4 enables the sources. Captured
> from the design session; spans **wizard + posthog + context-mill** (+ a one-time OAuth-ceiling edit).
> Symbol names are durable; `file:line` anchors are point-in-time. Keep in lockstep once it lands.

### 9.1 Decisions (settled)

- **New "Enable products" step** runs after §2 step 2 (*Read context*) and **before** STEP 4 (*Enable
  sources*). It turns on **Session Replay** + **Error Tracking** every run; **Support/Conversations** is
  flag-on + a report CTA only (9.4). **STEP 4 is unchanged** — once products are on, its existing "enable
  sources for products in use" rule picks them up.
- **One path for everyone.** No free/paid fork, no consent prompt, no per-framework skill fork.
- **No billing writes.** The "$0 spend cap" idea is **dropped**: `custom_limits_usd` is org-wide, set via an
  `INTERNAL`-scoped endpoint (`ee/api/billing.py`) unreachable by any OAuth token, and a $0 cap *harms*
  existing paying users (caps + drops data across all their projects; `ee/billing/quota_limiting.py`).
  `remote_config.py` even force-disables replay when recordings are quota-limited. Cost overruns are handled
  **reactively (refunds)** — a product decision.
- **Transparency + PII.** No prompt, but the **report/outro discloses** what was enabled, and the replay
  recipe **sets conservative masking** server-side. `recording_domains` defaults to *all domains incl.
  production*, so masking is the safeguard. **TODO: verify the posthog-js default masking** first.
- **Web first.** A server-side flip only activates products for SDKs that read remote config (posthog-js).
  Backend/mobile need generated **code** → phase 2 (9.6).

### 9.2 Write path — intent-based `products-enable`, NOT `project:write`

- **Not `project:write`:** it makes `ProjectViewSet` (a `ModelViewSet`, `scope_object="project"`) writable →
  authorizes `DELETE /api/projects/:id` + ~60 team fields incl. `access_control` (RBAC),
  `session_recording_masking_config` (PII), `app_urls`, `test_account_filters` (`posthog/api/project.py`
  `team_passthrough_fields`). Every *existing* wizard write scope is a product-object write — none can delete
  the project or rewrite security/privacy config. It's also a **permanent, org-wide ceiling** change on a
  **public npm** tool (every external user grants it), and breaks self-driving's "read-only + narrow product
  writes" property.
- **Not per-product settings viewsets:** doesn't scale — each new product (logs, heatmaps, surveys…) =
  another viewset + tool + scope. (Precedent that *does* work this way: `ErrorTrackingSettingsViewSet`,
  `scope_object="error_tracking"`, in `posthog/products/error_tracking/backend/presentation/views/settings.py`.)
- **Chosen — one intent-based surface.** `products-enable {products: ProductKey[]}`, gated by **one** new
  narrow scope **`product_enablement:write`**. The caller names *which* products; the **server owns the
  recipe** per product (toggle + companion defaults). The caller passes **no field values**, so it cannot
  weaken masking or set bad limits. **Adding a product later = register a recipe + add an enum key** — no
  wizard/scope/ceiling change. Most enable-levers are flat Team opt-in bools in the same
  `team_passthrough_fields` list (`heatmaps_opt_in`, `surveys_opt_in`, `capture_console_log_opt_in`,
  `capture_performance_opt_in`, `autocapture_opt_out`, `session_recording_opt_in`,
  `autocapture_exceptions_opt_in`, `conversations_enabled`), so one surface covers them all.

### 9.3 Recipes (server-owned, posthog)

A thin `ProductEnablementViewSet` iterates the requested keys → dispatches to a per-product recipe each
product module registers. Primary toggle is **always** set; companion settings are applied **only if unset**
(don't clobber a user's existing custom config). Examples:

- `session_replay` → `team.session_recording_opt_in = True`; if `session_recording_masking_config` unset →
  default masking. (`posthog/models/team/team.py:361`.)
- `error_tracking` → `team.autocapture_exceptions_opt_in = True`; `ErrorTrackingSettings.objects.get_or_create`
  for default limits. (`team.py:466`; `ErrorTrackingSettings` model defaults, `error_tracking/backend/models.py:604`.)
- `conversations` (later) → `team.conversations_enabled = True` (`team.py:438`).

Open: whether replay should **always enforce** a masking floor vs apply-if-unset (per-recipe choice).

### 9.4 Mechanism facts (verified — don't re-derive)

- **Replay (web):** `session_recording_opt_in=true` → `remote_config.py:262` emits the `sessionRecording`
  block → posthog-js `isRecordingEnabled = window && serverEnabled && !disable_session_recording && !optedOut`
  → records **on next page load**. No code change for a default-config web SDK.
- **Error tracking (web):** `autocapture_exceptions_opt_in=true` → `remote_config.py:240` emits
  `autocaptureExceptions` → posthog-js hooks `window.onerror`/rejections (uses the remote flag when the client
  `capture_exceptions` is unset). No code change.
- **The step CHECKS (and edits) the init snippet:** if the wizard's posthog-js init set
  `disable_session_recording: true` / `capture_exceptions: false`, the client overrides the remote flag and
  the flip is **inert**. Phase-1 reads the init in the user's repo and edits it to not override (warlock/YARA
  scans apply to the edit). Snippet content lives in context-mill (off-disk).
- **Backend/mobile:** the Team flags are **inert** (no posthog-js to read them) → phase 2.
- **Conversations is inert as a flag flip:** the `conversations` signal source reads `Ticket` rows
  (`products/signals/backend/emission/fetchers/conversations.py`); tickets are created only by a connected
  channel — widget/email/Slack/Teams (`create_with_number`, `products/conversations/backend/signals.py:79`).
  So phase 1 = flip `conversations_enabled` (cheap, "eases the start") + enable the `conversations`
  `SignalSourceConfig` (already callable, `task:write`) + a **report CTA** ("connect a channel"). Real fix =
  the widget embed (phase 2). NB enabling auto-generates `widget_public_token` (`team.py:2367`) but leaves
  `widget_enabled=false`.

### 9.5 Framework coverage (90-day wizard telemetry, `internal-j`)

Break `wizard: setup confirmed` down by `properties.integration` (on the terminal `setup wizard finished`
event, `integration` is nested under `properties.tags`). Buckets:

- **Web ~58%** (nextjs 41%, react-router, astro, tanstack-*, vue, sveltekit, nuxt, angular, javascript_web)
  → **covered by the phase-1 server flip** (client replay + client errors).
- **Pure backend ~23%** (javascript_node **16.8%**, fastapi, python, flask, ruby) → flip is a **no-op**;
  needs code (phase 2).
- **Mobile ~14%** (react-native **10.1%**, swift, android) → no-op; SDK-init code (phase 2).
- **Hybrid ~3%** (laravel, django, rails) → partial (only if they load posthog-js). Undetected ~4%.

**Phase-2 priority is node-first** (16.8% — the single biggest slice the flip misses), then react-native.

### 9.6 Phase 2 (deferred — context-mill, no new posthog scope)

The backend/mobile lever is generated **code** (the agent already edits the repo), so it's a context-mill
skill change, not platform work:

- Backend error tracking, **node-first** → python/fastapi/flask → ruby/php: enable exception autocapture in
  the SDK init (e.g. python `enable_exception_autocapture=True`).
- Mobile (RN/swift/android): SDK-init replay + exception options (min-version-gated).
- **Support widget embed** (web): inject the widget snippet + `widget_enabled` → makes Conversations actually
  produce tickets (upgrades 9.4's CTA to auto-done).
- Server-side error tracking for full-stack web (e.g. Next.js API routes via posthog-node).

### 9.7 Cross-repo work list

- **posthog:** `ProductEnablementViewSet` + `products-enable` MCP tool + per-product recipes
  (replay/error-tracking now; conversations later) + new scope object `product_enablement` (`posthog/scopes.py`).
  **Admin-RBAC decision:** the new route bypasses the `field_access_control('project','admin')` check
  (enforced only in `project.py`) — relax for an opt-in enable, or replicate.
- **OAuth ceiling (manual, both regions):** add `product_enablement:write` to the wizard OAuth app
  `OAuthApplication.scopes` — US prod client `c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM` + dev
  `DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ`. Net-new (mechanics: §7 item 1).
- **wizard:** add `product_enablement:write` to `SELF_DRIVING_SCOPE_ADDITIONS` (`program-scopes.ts`); new
  "Enable products" step in `prompt.ts` (detect web via `session.integration` → call `products-enable` with
  the list → check/edit the posthog-js init; backend/mobile skip + record for the report). Keep the existing
  replay/exception opt-in reads (idempotency); the `customer_id` consent threading is **not** needed. Update
  the §2 step backbone + this doc.
- **context-mill:** new skill ref `…-enable-products.md` before `4-sources.md`; update `description.md` step
  list (→ 9 steps); `7-report.md` adds the "enabled products" disclosure + the Conversations CTA.

### 9.8 Open items

- Verify posthog-js **default masking**; decide always-enforce vs apply-if-unset (9.3).
- **Admin-RBAC** bypass decision (9.7).
- **Logs** likely isn't a Team opt-in toggle (OTel ingestion, "on when data arrives") — verify before adding a recipe.
- Idempotent enable; silent re-enable **will re-enable a setting a user turned off deliberately** (the flag
  default `False` can't distinguish "never set" from "off on purpose") — accepted under "enable everyone."
- Refund operational process (no consent, no cap).

---

## Cross-references

- Wizard design discipline: repo-root `CLAUDE.md`, `.claude/skills/wizard-development/`.
- Signals backend internals + the reset command in full: `posthog/products/signals/ARCHITECTURE.md`.
- Scout authoring: `posthog/products/signals/skills/authoring-signals-scouts/SKILL.md`.
- The setup skill: `context-mill/context/skills/self-driving/`. Security rules: the `warlock` repo.
