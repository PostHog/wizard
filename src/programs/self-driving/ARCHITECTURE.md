# Self-driving — Wizard Program Architecture

How the `self-driving` program works: the program that runs on
`npx @posthog/wizard self-driving` and sets up **PostHog Signals** for a
project. It spans **three repos**; the load-bearing idea is the **division of
labor** (§1) — the wizard owns _order + mechanics + URLs_, context-mill owns
_how each step is done_, posthog owns _the backend and the gating_.

> [!IMPORTANT]
>
> **Keep this doc in lockstep with the code.** If you change anything in this
> scope — a step, the prompt, an OAuth scope, a feature flag, an MCP tool the
> agent calls, a skill reference, the scout/source models, or the gating —
> update this file in the same change. The most drift-prone parts are the
> **OAuth scopes (§3 / §7)** and the **gating (§6)**.

Paths with no prefix are in `wizard`; cross-repo paths are prefixed `posthog/…`
/ `context-mill/…`. `file:line` anchors can drift; the symbol names are the
durable part.

### Where to look

| Need                                  | Go to                                                      |
| ------------------------------------- | ---------------------------------------------------------- |
| The ordered steps                     | `src/programs/self-driving/prompt.ts`                      |
| What each step _does_                 | `context-mill/context/skills/self-driving/references/*.md` |
| Program registration / lifecycle      | `src/programs/self-driving/index.ts`                       |
| `wizard_ask` / `.env` tools           | `src/agent/tools/`, `src/agent/wizard-ask-bridge.ts`       |
| OAuth scopes (+ prod ceiling)         | `src/programs/self-driving/scopes.ts` (§3, §7)             |
| Signals models / MCP / sync           | `posthog/products/signals/backend/…` (§5)                  |
| Why a team gets no findings           | §6                                                         |
| What to change for prod               | §7                                                         |
| Local dev + reset                     | §8                                                         |
| Proactive product enablement (step 3) | §9                                                         |

---

## 1. Division of labor

- **`wizard` (machinery).** The runner, agent loop, TUI core, `wizard-tools` MCP
  server, OAuth, and YARA hooks know nothing about Signals. The Signals-specific
  code is the program folder — its **prompt** (`prompt.ts` — the _order_ +
  mechanics), its **config/lifecycle** (`index.ts`), its **abort vocabulary**
  (`detect.ts`), and its **OAuth scope additions** (`scopes.ts`) — its TUI
  folder (`src/tui/programs/self-driving/`, §3), and its program commandments
  and routing flag in the agent's switchboard (§3).
- **`context-mill` (the HOW).** The installed `self-driving-setup` skill is the
  source of truth for _how_ each step runs — tools, recipes, verification. The
  wizard ships only the skill **ID**; the body is fetched at runtime and can
  change independently of the wizard release.
- **`posthog` (backend + gating).** The models the agent writes
  (`SignalSourceConfig`, `SignalScoutConfig`, custom `LLMSkill` scouts), the MCP
  tools, the on-demand troop `sync` endpoint, the canonical scouts, and the
  gating (two flags, AI consent, the pre-run GitHub gate) that decides whether
  anything runs.

The config declares `requires: ['posthog-integration']`, which is metadata, not
a runtime gate. `detect.ts` checks that the install dir is a readable directory
and whether PostHog is already in the project (`POSTHOG_PRESENT_KEY`). When it
isn't, the flow offers to run `posthog-integration` first, composed, in the
project the user picks (the integrate path, §3).

**Naming.** The wizard side uses "self-driving" everywhere: the CLI command and
program id `self-driving` (`selfDrivingCommand` in
`src/cli/commands/self-driving.ts`), the `SELF_DRIVING_*` constants, the
`SelfDriving*` types and screens, the screen id `self-driving-intro`, the report
`posthog-self-driving-report.md`, and every user-facing string ("Self-driving").
The skill id is a wizard↔context-mill contract: `SELF_DRIVING_SKILL_ID` must
equal `self-driving-setup`, and a prod wizard needs that skill published to
`latest`. posthog keeps its own names: the UI flag `product-autonomy` /
`FEATURE_FLAGS.PRODUCT_AUTONOMY` (§6), and the `signals_*` / `SignalScout*`
identifiers, which don't carry the program name.

---

## 2. The run (9 steps)

The agent makes its 9-item task list up front (one `TaskCreate`), drives it with
`TaskUpdate`, and asks the user only via `wizard_ask` (batched). Each prompt
STEP names a skill reference whose matching context-mill file carries the HOW.
**Step labels mirror the skill files exactly** — including the letter-suffix
sub-steps `6b` (custom scouts) and `6c` (Replay Vision scanners) — so a prompt
`STEP` and its `(skill: …)` reference never disagree on the number.

**Step backbone (expected action, one line each):**

- **1 — Check access** — **instant, no probe.** Self-driving is in **open beta**
  (available to every team), so there is no access gate to check; the step just
  marks itself in_progress→completed (no MCP call) so the step-tracking funnel
  still fires and the user gets an immediate first checkmark.
  `[ABORT] self-driving is not available for this project` is kept only as a
  safety net for a genuine Signals-API outage during the run.
- **2 — Read context** — build an evidence picture of which products are in use
  (setup report + `signals-scout-project-profile-get` + cheap usage probes + a
  light repo scan); read-only.
- **3 — Enable products** — turn ON Session Replay + Error Tracking + Support
  via `products-enable` (server-owned recipes) so the next step's sources have
  data. Idempotent; web also gets a posthog-js init check, backend/mobile are
  inert (recorded for the report). See §9.
- **4 — Enable sources** — always enable the scout gate and health checks;
  enable the native sources whose products step 3 turned on (error tracking,
  support) by default, plus any other native source step-2 evidence shows in
  use. Support's source stays idle until a channel is connected (a follow-up).
  Replay has no source here: posthog has no session-summarization source, so
  step 6c's scanners are the replay path.
- **5 — Offer issue trackers** — one multi-select (GitHub Issues / Linear /
  Zendesk / pganalyze). Auto-connect what the run can: GitHub Issues (pick a
  repo — a single connected repo is used by default with no repo research;
  research which repo matches only when several are connected) and Linear
  (one-click OAuth link → single silent `integrations-list` check → create,
  never nudge). Zendesk / pganalyze need credentials the run never collects, so
  they're armed as dormant responders + a report follow-up — no UI redirect, no
  verification (a downstream reminder prompts the user to finish). Enable a
  (possibly dormant) responder for every pick.
- **6 — Configure scout troop** — materialize the canonical troop, read the
  enforced run budget via `scout-metadata-get` (100 scout runs/day per project
  by default during early access), then enable a selective set: `general`
  (always) + the **3–5 specialists** for the products this project uses most,
  with the whole troop (including step 6b) capped at **~10 enabled scouts**;
  never `error-tracking`/`session-replay` (consumed as native sources); disable
  the rest. The enabled troop lands at **4–10** (general + up to 5 specialists +
  up to 5 custom, both ceilings not quotas), well inside the default budget at
  the daily cadence.
- **6b — Design custom scouts** — gap-analyze the repo against the troop
  (starting from the repo's for-agents context — AGENTS.md, CLAUDE.md,
  ARCHITECTURE.md, `.cursor/rules` — when present), propose **at most 5**
  candidates in one ask (fewer when the ~10-scout troop ceiling or a low
  enforced run budget leaves less room), each a plain-language `label` + a
  dimmed `description`, behind a leading "None — keep the built-in troop"
  option. The wizard's program commandments (§3) make the agent always propose
  its one or two strongest candidates, even where the skill would skip the ask;
  declining them all is valid. Create the approved subset (the only place custom
  scouts are made).
- **6c — Replay Vision scanners** — the push layer: create the scanner skeletons
  the skill defines, with `emits_signals: true`, filling only the per-product
  blanks (`query`, `{{PRODUCT_CONTEXT}}`) from the repo. Never aborts. The skill
  owns the skeletons and the rules that keep them cheap and non-duplicative; the
  wizard owns the scope and this ordering. See §10.
- **7 — Write report** — write `./posthog-self-driving-report.md` (everything
  changed + follow-ups); findings reach the inbox in ~30 min.

The table below adds the skill reference and the tool/MCP surface for each.

| #   | Step                             | Skill ref / file                      | Tools · surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Check access                     | `1-check-access.md`                   | **No probe — instant** (open beta: available to every team). Marks the task in_progress→completed immediately, calls no MCP tool. The `[ABORT] self-driving is not available for this project` string remains a safety net for a genuine Signals-API outage during the run, not a beta gate.                                                                                                                                                                                                                                                                                                                                                                                   |
| 2   | Read project & Signals state     | `2-read-context.md`                   | `./posthog-setup-report.md` + `signals-scout-project-profile-get` + cheap usage probes. Prompt opt-ins are authoritative ("repo evidence rules a product IN, never OUT").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | Enable products                  | `3-enable-products.md`                | `products-enable {products:[session_replay,error_tracking,conversations]}` flips the product toggles (server-owned recipes, conservative defaults). Idempotent. Web also gets a posthog-js init check; backend/mobile are inert → recorded for the report. See §9.                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | Enable signal sources            | `4-sources.md`                        | Create/enable `SignalSourceConfig` rows (`inbox-source-configs-*`). The native sources for the step-3 products (error tracking, support) go on by default; others follow step-2 evidence. Always enables the scout gate `signals_scout`/`cross_source_issue`. Always enable the health check gate `health_checks`/`health_issue`. Never enables an unconfirmed connected tool.                                                                                                                                                                                                                                                                                                 |
| 5   | Offer issue-tracker integrations | `5-connected-tools.md` (+ `5a`, `5b`) | One batched multi-select for GitHub Issues / Linear / Zendesk / pganalyze. GitHub Issues & Linear auto-connect via `external-data-sources-create` (GitHub Issues: one connected repo → use it by default, no repo research; Linear: OAuth link + one silent `integrations-list`, never nudge); Zendesk / pganalyze are armed dormant + report follow-up (no UI redirect, no verify). Enable a (possibly dormant) responder per pick.                                                                                                                                                                                                                                           |
| 6   | Configure the scout troop        | `6-scouts.md`                         | `signals-scout-config-sync` materializes the troop (~19 scouts, grows over time); `scout-metadata-get` reports the enforced run budget (100 runs/day default); enable `general` + the **3–5 specialists** for the most-used products (agent judgment over step-2 evidence), keeping the whole troop at or under **~10 enabled scouts**, never `error-tracking`/`session-replay` (covered by native sources), fall back to one universal cross-product scout if no surface qualifies, disable all the rest (`signals-scout-config-update {enabled:false}`). Never touches `emit`/`run_interval`.                                                                                |
| 6b  | Design custom scouts             | `6b-tailor-scouts.md`                 | The **only** place custom scouts are created. Gap-analyze repo surfaces vs the troop, reading the repo's for-agents context first (AGENTS.md, CLAUDE.md, ARCHITECTURE.md, `.cursor/rules`) as the map of surfaces and vocabulary; propose **at most 5** in ONE `wizard_ask` (bounded by the ~10-scout troop ceiling and the enforced run budget), each option carrying a `description` (an optional `wizard_ask` option field rendered dimmed/wrapped under the label) plus a leading "None" option, which has the initial focus; create approved ones via `llma-skill-create` (`signals-scout-<scope>`). **Canonical bodies never edited.** Declining is valid, not an abort. |
| 6c  | Replay Vision scanners           | `6c-replay-vision-scanners.md`        | `vision-scanners-*` (list/create/update, plus the advisory estimate). Creates the skill's scanner skeletons with `emits_signals: true`; the agent fills only `query` + `{{PRODUCT_CONTEXT}}`. **No `SignalSourceConfig` row** — `emits_signals` on the scanner _is_ the per-source config (`replay_vision`/`scanner_finding` is self-authorizing server-side), so step 4 skips it. Never aborts. See §10.                                                                                                                                                                                                                                                                      |
| 7   | Write report & hand off          | `7-report.md`                         | Write `./posthog-self-driving-report.md`; findings appear in the inbox in ~30 min.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Abort contract:** the skill emits exact `[ABORT] <reason>` strings; the wizard
matches them against `SELF_DRIVING_ABORT_CASES` (`detect.ts`) for tailored error
outros. The reason strings are a cross-repo contract (`detect.ts` regex ↔ skill
emit ↔ test) and are never displayed — change one, change both repos.

---

## 3. Wizard internals

**Program definition** (`src/programs/self-driving/`): `index.ts` (config +
lifecycle, and the program's only entry, `@programs/self-driving`), `prompt.ts`
(the 9 steps + mechanics + project URLs), `detect.ts` (prerequisite check +
abort vocabulary), `detect-agentic.ts` (the integrate path's project scan and
`prepSelfDrivingIntegration`), `pricing.ts` (the price copy the TUI shows) and
`step-keys.ts` (canonical `wizard: step` analytics keys). The config's
`runSteps['integrate-run']` runs `posthog-integration` composed, scoped to the
picked sub-app. `config` in `index.ts` is built from the `createSkillProgram`
factory (`src/programs/shared/skill-program.ts`) with overrides. Notables in
`index.ts`: `SELF_DRIVING_SKILL_ID = 'self-driving-setup'`,
`REPORT_FILE = 'posthog-self-driving-report.md'`, `maxQuestions: 13` (tracker
picks + custom-scout proposal), `richLinks: true` (OSC-8 links so long OAuth
URLs survive wrapping), and `postRun` (just `removeInstalledSkill` — the setup
skill is transient, marker-guarded by `.posthog-wizard`, so there's no
keep-skills step). CLI: `src/cli/commands/self-driving.ts`; `--install-dir`
becomes `session.installDir` (the agent's working dir and detection target).

**Outro.** `buildOutroData` renders a **Self-driving inbox** link
(`…/project/:id/inbox`, shown verbatim: no UTM, no auth deep-link) labeled "Your
Self-driving inbox", plus an "In your inbox you can:" next-steps list and the
pricing body. Both ride the generic `OutroData` fields `primaryLink` (a labeled
link under the headline) and `nextSteps` (a heading + bullets), which the shared
`OutroScreen` renders. The Signals-specific copy stays in the program's
`buildOutroData`, so no product knowledge reaches the screen.

**TUI side** (`src/tui/programs/self-driving/`): `flow.ts` (the screen flow
`intro → integration-check → health-check → auth → integrate-detect → integrate-run → self-driving-handoff → self-driving-github → run → outro`),
`screens/`, and `deck/`. `SelfDrivingIntroScreen.tsx` passes its own `subtitle`
to `IntroScreenLayout`: "We'll use AI to analyze your project and set up PostHog
Self-driving.", then the ".env\* file contents will not leave your machine."
line every intro keeps. Screens that pass no `subtitle` get the generic lines.
`deck/index.tsx` is the LearnCard deck and `deck/tips.ts` is the `Tips`-sidebar
copy that defines signal sources + scouts + scanners in plain language. Both are
set in `src/tui/programs/self-driving/index.tsx`. `RunScreen` resolves the deck
with `getTuiProgram(activeProgram).deck ?? getSkillContentBlocks`, and
`TipsCard` falls back to `DEFAULT_TIPS` when a program has no tips, so every
other skill program keeps the shared deck
(`src/tui/programs/shared/skill-deck.tsx`, last block `pause: 60000`) and the
default tips. The self-driving deck's last block pauses 10 s. No branch on
`activeProgram === 'self-driving'` lives in `RunScreen` or `LearnCard`.

**Runner & agent loop (generic — not Signals-aware).** `runAgent`
(`src/agent/runner/index.ts`) prepares the run (logging targets, gateway mint,
scan triage), then runs the linear pipeline
`[skill install] → agent init → prompt → run → errors → [postRun] → outro`. It
installs the skill by ID, resolves the MCP URL, runs the agent with the PostHog
MCP server and the `wizard-tools` tools, and parses agent output: `[STATUS]` →
UI, `[ABORT] <reason>` → matched against the run's `abortCases`. `PromptContext`
(project/host, org AI consent and team product opt-ins, from `/api/users/@me/`
and `/api/projects/:id/`) feeds `buildSelfDrivingPrompt`. Anything deeper here
is generic machinery — read those files directly.

**Routing and commandments** (`src/agent/runner/switchboard/`). The config sets
no `binding`, so the run uses `DEFAULT_BINDING` (Pi, linear) unless the
`wizard-self-driving-use-pi-harness` flag's payload pins a model, effort,
harness or sequence (`flags/self-driving.ts`). The program's own commandments,
`SELF_DRIVING` in `commandments.ts`, tell the agent to always bring a
custom-scout proposal in step 6b, to rank candidates by whether an enabled scout
would actually fire, and to say in an option's description when it overlaps an
enabled scout.

**`wizard-tools` MCP + `wizard_ask`** (`src/agent/tools/`). `check_env_keys` /
`set_env_values` are the only sanctioned `.env` access (value-safe,
`.gitignore`-guarded, secret-vault aware). `wizard_ask` is the **only** way to
ask the user anything — questions batched per call, with `maxQuestions` (13)
calls per run. Each call carries an optional `subject` tag; the one-time
batch-your-questions nudge counts consecutive calls **per subject**, so a step
that walks a list (one call per detected source) is never interrupted, while
repeated prompting about one thing still gets nudged. Each `single`/`multi`
option is `{ label, value, description? }`. `description` is optional. Only the
multi-select render path (`PickerMenu`'s `MultiPickerMenu` + `WizardAskScreen`)
shows it, dimmed and wrapped beneath the label; single-select rows are
label-only, and `WizardAskScreen` adds per-row spacing only when an option has a
description. The wizard doesn't clamp how many options a question offers; the
custom-scout limit is product knowledge and lives in the skill. In a
multi-select the focus starts on the first enabled option, `enter` toggles the
focused option, and the Confirm button below the options submits the selection.
The skill puts a **decline option first** on every self-driving `wizard_ask`, so
it holds that initial focus: step 6b ("None — keep the built-in troop"), step 5
("None of these"), 5a ("Skip GitHub Issues", with the fallback "Skip for now")
and 5b ("Skip Linear"). The rule is cross-cutting in the skill's
`description.md`, since the agent builds every ask, so it needs no wizard code.
With no bridge (CI/non-interactive), the tool returns an error telling the agent
to proceed with defaults or emit `[ABORT] requirements-incomplete`, and the
self-driving prompt tells it to emit `[ABORT] requires-interactive-mode` and
halt. The bridge (`src/agent/wizard-ask-bridge.ts`) brokers into the TUI
overlay; cancelled/timed-out fields resolve to
`CANCELLED_SENTINEL = '__cancelled__'`.

**OAuth scopes** (`src/programs/self-driving/scopes.ts`). Base
`WIZARD_OAUTH_SCOPES` (`src/shared/constants.ts`) ∪
`SELF_DRIVING_SCOPE_ADDITIONS` — **15 strings**, requested via a PKCE auth-code
flow:

| Scope                                                          | Why                                                                                                                                                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task:read`, `task:write`                                      | The signal **source** config API (`inbox-source-configs-*`) is under the generic `task` scope (not a Signals-specific one).                                                                  |
| `integration:read`                                             | `integrations-list` — the pre-run GitHub gate + step 5's tracker verify.                                                                                                                     |
| `signal_scout:read`, `signal_scout:write`                      | List/sync/tune the scout troop (STEP 6).                                                                                                                                                     |
| `session_recording:read`, `survey:read`, `error_tracking:read` | Read-only usage probes (STEP 2).                                                                                                                                                             |
| `external_data_source:read`, `external_data_source:write`      | Create/verify warehouse sources (STEP 5).                                                                                                                                                    |
| `llm_skill:read`, `llm_skill:write`                            | Read the authoring guide + canonical bodies, create approved custom scouts (STEP 6b).                                                                                                        |
| `product_enablement:write`                                     | The "Enable products" step turns on Session Replay / Error Tracking / Support (`products-enable`) without the broader `project:write`.                                                       |
| `replay_scanner:read`, `replay_scanner:write`                  | List/create Replay Vision scanners (STEP 6c). Object is `replay_scanner` — the `vision-scanners-*` names are MCP tools, not scopes. Create/update also use `session_recording:read` (above). |

The prod `OAuthApplication.scopes` ceiling **uses the `@default` sentinel**
(`posthog/scopes.py`, `resolve_ceiling`), not an exhaustive literal list. The
live US value is
`@default,llm_gateway:read,wizard_session:read,wizard_session:write`, where
`@default` resolves to `UNPRIVILEGED_SCOPES` — every public (non-privileged,
non-internal, non-hidden) `obj:action` scope, auto-tracking new ones. **Every
addition above is a normal public scope object, so all are already inside the
ceiling — no per-scope ceiling edit is needed.** Only a
privileged/internal/hidden object would need a manual per-app edit; the wizard
requests none. (An _exhaustive_ ceiling — no `@default` — is possible and would
reject anything unlisted, but the wizard apps aren't configured that way.) See
§7 item 1 and the README's "OAuth app scope ceiling".

**Security & TUI.** YARA hooks (`src/agent/yara-hooks.ts`) scan Bash commands
and `publish_handoff` reports before they run, Write/Edit and Read/Grep content
after, and the skills a Bash install fetches, via the `warlock` scanner
(fail-closed; categories: prompt injection, exfiltration, destructive ops,
supply-chain, secrets, PII); a critical match aborts the run. New rules go in
`warlock`. The agent writes the report (`OutroScreen` surfaces it with the inbox
link and next-steps list, see **Outro** above); progress comes from the agent's
`TaskCreate`/`TaskUpdate` calls synced to the TUI.

---

## 4. context-mill: the `self-driving-setup` skill

Source: `context-mill/context/skills/self-driving/`. `config.yaml`
(`template: description.md`, `tags: [signals, self-driving]`, no fetched docs),
`description.md` (becomes `SKILL.md`; declares the step chain + the
cross-cutting rules: trust the setup report, list-before-create idempotency,
only switch sources on, ask-then-connect, **canonical scout bodies never edited
— new scouts only in step 6b**, decline-option-first on every `wizard_ask`), and
the `references/` chain
`1-check-access → 2-read-context → 3-enable-products → 4-sources → 5-connected-tools`
(+ `5a-github`, `5b-linear`)
`→ 6-scouts → 6b-tailor-scouts → 6c-replay-vision-scanners → 7-report` (chained
by `next_step` frontmatter; what each does is in the §2 table).

The canonical `signals-scout-*` skills do **not** live here — they're in posthog
(§5). context-mill ships only the orchestration skill.

**Build & consumption.** `pnpm build` renders per-skill ZIPs
(`dist/skills/self-driving-setup.zip`), a bundle and `skill-menu.json`; the dev
server (`pnpm dev`, port **8765**) hot-rebuilds individual skill zips but
**not** the bundle. Release: a PR to `main` with the **`mcp-publish`** label
builds and force-moves the `latest` GitHub release tag. The wizard resolves the
skill ID at runtime against `getSkillsBaseUrl()` (`src/shared/constants.ts`):
`…/releases/latest/download` (prod) or `localhost:8765` (`--local-context-mill`)
— so skill content is decoupled from the wizard npm release (and a prod wizard
is broken until the skill is published to `latest`; §7).

---

## 5. posthog: Signals / scout backend

Under `posthog/products/signals/backend/`.

**Sources.** `SignalSourceConfig` (`models.py`): one row per
`(team, source_product, source_type)`, `enabled` (default true);
`is_source_enabled` gates emit (`llm_analytics` always allowed). The flow always
flips on two sources regardless of evidence: the scout gate
`signals_scout`/`cross_source_issue` and health checks
`health_checks`/`health_issue` (instrumentation findings are always actionable).
MCP: `inbox-source-configs-*` (under the `task` scope); `-destroy` disabled.
Enabling can trigger server-side side-effects (backfills, schedules, data-import
sync).

**Scout troop.** `SignalScoutConfig` (`models.py`): per `(team, skill_name)`,
`enabled` (participation), `emit` (dry-run vs emit, default on),
`run_interval_minutes` (default 1440 — daily). Canonical troop (~19
`signals-scout-*` skills, and growing) in `posthog/products/signals/skills/`.
Scout runs are budgeted per team: the coordinator enforces caps resolved from
the `signals-scout` flag payload (`team_configs[team]` → `default_team_config` →
code constant, `scout_harness/team_limits.py`); `default_team_config` currently
sets `max_runs_per_day: 100` and `max_runs_per_tick: 3`, so a project gets up to
100 scout runs/day by default during early access. Note the two caps compose —
the coordinator ticks every 30 minutes, so the per-tick cap bounds a team at
`max_runs_per_tick × 48` a day regardless of the daily number. The MCP
`scout-metadata-get` tool (`scout/metadata/current/`) reports the enforced
limits + the announcement banner, and STEP 6 reads it to size the troop. STEP 6
does **not** hardcode the list — it works from whatever
`signals-scout-config-sync` returns and enables a **selective set**: `general`
is the only **always-on** scout; **3–5 specialists** are enabled for the
products this project uses most (agent judgment over step-2 evidence —
`top_events` volume, recent activity, active config counts; `2-read-context.md`
gathers that usage ranking). The specialist candidate pool is the rest of the
troop — the surface-specific scouts (`product-analytics`, `web-analytics`,
`feature-flags`, `surveys`, `revenue-analytics`, `ai-observability`, `logs`,
`csp-violations`, `experiments`, `customer-analytics`, `data-pipelines`,
`replay-vision`) plus the cross-product
`anomaly-detection`/`observability-gaps`/`health-checks`/`inbox-validation` —
**excluding** `error-tracking`/`session-replay`, which are deliberately never
enabled because each surface already has its own pipeline (step 4's native
source for error tracking, step 6c's scanners for replay) that a scout would
duplicate; `6b` bars custom scouts from re-covering them too. If no surface
clearly qualifies, one universal cross-product scout (`anomaly-detection` or
`health-checks`) is the fallback so ≥1 specialist always runs. Everything else
is disabled; the enabled troop caps at **~10** (general, 3–5 specialists and 0–5
custom from STEP 6b). Per `6-scouts.md`; plus the `authoring-signals-scouts`
companion (not a scout). `lazy_seed.py` mirrors the on-disk canonical skills
into per-team `LLMSkill` rows: `sync_canonical_skills` only ever touches rows
stamped `metadata.seeded_by == "signals_scout_harness"` (content-hash gated; a
team-edited copy stops receiving updates); `register_missing_configs` gives each
live `signals-scout-*` skill a config ("author a skill, get a scout"). The
wizard's STEP 6 calls MCP `signals-scout-config-sync` →
`POST …/signals/scout/configs/sync/` (scope `signal_scout:write`) to do both
immediately instead of waiting for the Temporal coordinator's tick.

**Custom scouts.** A scout is just an `LLMSkill` whose name starts
`signals-scout-` (model: `posthog/products/skills/backend/models/skills.py`).
The agent authors them via `llma-skill-create`/`-get`/`-list` (scope
`llm_skill:*`), guided by `authoring-signals-scouts`. A custom scout has **no
`seeded_by` marker** — the single authoritative canonical-vs-custom
discriminator (used by sync, prune, and the reset command in §8).

**External data sources (issue trackers).** STEP 5 creates a warehouse source
via the data_warehouse MCP (`external-data-sources-create`, scope
`external_data_source:write`), which **injects `created_via: mcp`**
(`posthog/products/data_warehouse/mcp/tools.yaml`) — the marker distinguishing
self-driving-created sources from a user's own. There's no FK between
`SignalSourceConfig` and `ExternalDataSource` (the signals layer attaches by
`(team, source_type, schema_name)`), which is why the reset (§8) tears them down
separately, scoped to `created_via=MCP`.

**Emit gating.** A finding reaches the inbox only if all of
`_preflight_emit_gates` (`scout_harness/tools/emit.py`) pass: the run has a
`scout_config`, the scout's `emit=True`, the org's
`is_ai_data_processing_approved`, and the `signals_scout`/`cross_source_issue`
source is enabled.

---

## 6. Gating & prerequisites — "will it actually work?"

> [!NOTE]
>
> **Open beta: the wizard probes no access.** Self-driving is in open beta
> (available to every team), so STEP 1 calls no MCP tool and runs instantly; the
> wizard surfaces no beta gate of its own. The PostHog-side gates below still
> apply **server-side** (a flag not yet at 100% just means findings won't
> surface), and the `[ABORT] self-driving is not available for this project`
> path is only a safety net for a genuine Signals-API outage.

1. **UI flag `product-autonomy`** (`posthog/frontend/src/shared/constants.tsx`,
   `FEATURE_FLAGS.PRODUCT_AUTONOMY`). Frontend-only — gates the Inbox scene, nav
   item, and source-config loading. Off → the user can't _see_ the inbox; the
   pipeline is unaffected.
2. **Scout-execution flag `signals-scout`** (`scout_coordinator.py`,
   `SIGNALS_SCOUT_DOGFOOD_FLAG`). The real server gate, read for distinct_id
   `internal_signals_scout_team_discovery`. Its JSON payload has
   `guaranteed_team_ids` / `skip_team_ids` (enrolled = guaranteed − skip).
   **Must stay 100%-on.** Fallback `DEFAULT_ENROLLED_TEAM_IDS = [1, 2, 148051]`
   applies only on `is_cloud()` or `DEBUG` (so local team 1 is enrolled);
   self-hosted non-DEBUG fails closed.
3. **AI data processing approval** —
   `Organization.is_ai_data_processing_approved`
   (`posthog/models/organization.py`, default `True`, nullable; admin toggle at
   `/settings/organization#organization-ai-consent`). Fail-closed; without it
   findings are silently dropped. Enforced for this program by the **base
   wizard's AI opt-in gate** (`src/tui/ai-opt-in-gate.ts`, `withAiOptInGate`):
   it injects an `ai-opt-in` step after `auth` for every program, and
   `store.getGate('ai-opt-in')` parks the agent until approval lands — so the
   run can't reach the agent unapproved. Neither the prompt nor the skill has an
   AI-approval step: the gate fully owns consent before the agent starts.
4. **GitHub integration** (kind `"github"`, team or user level) — required and
   verified by the wizard's pre-run gate, or repo selection degrades to
   `no_repo`. UI: `/settings/environment-integrations#integration-github`.

Plus the **Temporal coordinator schedule**
(`signals-scout-coordinator-schedule`, workflow `run-signals-scout-coordinator`)
must be running, or no scout ever dispatches.

---

## 7. Prod-merge checklist

> [!IMPORTANT]
>
> Cross-repo launch actions. The flag items are **manual config, not deploys** —
> easiest to forget. Update this list whenever you add/rename a scope, flag, or
> backend surface.

1. **OAuth scope ceiling — NO ACTION NEEDED for self-driving's scopes.** The
   live wizard apps' `OAuthApplication.scopes` use the `@default` sentinel
   (`posthog/scopes.py`, `resolve_ceiling`) — US prod is
   `@default,llm_gateway:read,wizard_session:read,wizard_session:write`.
   `@default` resolves to `UNPRIVILEGED_SCOPES`, i.e. every public
   (non-privileged, non-internal, non-hidden) scope, and auto-tracks new ones.
   **All of self-driving's additions — `task:*`, `signal_scout:*`,
   `external_data_source:*`, `llm_skill:*`, `product_enablement:write`,
   `replay_scanner:*`, and the read-only probes — are normal public objects, so
   they are already inside the ceiling.** Verify before launch rather than
   assuming:
   `python manage.py seed_oauth_app_scopes --client-id <id> --scopes @default,llm_gateway:read,wizard_session:read,wizard_session:write --dry-run`
   (posthog), or evaluate the requested set against `resolve_ceiling`. A ceiling
   edit is required **only** if a future addition is a
   privileged/internal/hidden object (e.g. `llm_gateway:*`), which `@default`
   excludes by design. **One naming trap for step 6c:** the scope object is
   `replay_scanner` — `vision-scanners-*` are MCP tool names, not scopes;
   request the tool name and nothing is granted, so the step 403s. Client IDs
   (for reference, not for editing): US prod
   `c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM`, dev
   `DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ` (`localhost:8010`), and the prod
   EU app in the EU deployment (via `WIZARD_CLOUD_RUN_OAUTH_CLIENT_ID`) — each
   should carry the same `@default,…` value.
2. **context-mill skill release.** Merge `self-driving-setup` to `main` with the
   `mcp-publish` label so the `latest` release contains the skill ZIP — else the
   prod wizard can't fetch it. **Sequencing for the `wizard_ask` option
   `description`:** `6b` emits `wizard_ask` options with a `description` (and a
   leading "None" decline option). Ship a wizard npm release that has the
   `description` field **before** this skill release. The reverse order degrades
   gracefully — Zod strips the unknown key (the option schema isn't
   `.strict()`), so a wizard without the field drops descriptions and shows
   labels only — but wizard-first is the intended order. Decline-first ordering
   and the custom-scout cap are skill rules with no wizard dependency.
3. **posthog backend deploy**: the `sync` endpoint, companion seeding
   (`lazy_seed.py`), and the canonical scout skills.
4. **Temporal coordinator schedule** running in prod.
5. **Flag rollout (open beta = everyone):** `signals-scout` 100%-on for all
   teams (still the real server gate for dispatch); `product-autonomy` on for
   all users. STEP 1 probes no access, so an un-flagged team isn't turned away
   at setup — it just won't see findings until the server-side flags are on.
6. **Per-team runtime** (user's responsibility): org AI consent on, GitHub
   connected.

> [!NOTE]
>
> **Planned changes.** Open items, tracked alongside the prod checklist so they
> aren't forgotten (each notes its own trigger, where it has one):
>
> 1. **Downstream reminder for dormant connected-tool sources.** STEP 5 never
>    redirects users to the warehouse UI and never verifies Zendesk / pganalyze
>    (or an unfinished Linear): it arms the dormant responder and records a
>    report follow-up. The actual connection waits for a **downstream reminder**
>    (e.g. a Slack nudge) that tells the user to add the warehouse source. That
>    reminder is **out of the wizard's scope** (the CLI exits after the run), so
>    it lands in posthog / Signals: make sure such a reminder exists and picks
>    up these armed-but-dormant sources.
> 2. **GitHub Issues / Linear sync cadence → 1h.** The MCP source-create builds
>    the schema array server-side and defaults non-CDC sources to **6h**
>    (`external_data_source.py`), so STEP 5 leaves issue syncs at 6h. To tighten
>    the `issues` schema to `1hour` (a valid `sync_frequency`), the wizard MCP
>    must expose an `external-data-schemas` update tool (or add `sync_frequency`
>    passthrough to source-create); STEP 5a/5b would then PATCH the schema after
>    create. Deferred — 6h is fine for issue trackers.
> 3. **Don't make the user wait ~30 min for the first scan (if avoidable).** The
>    report/outro promises findings "within ~30 minutes" because fresh scout
>    configs only run on the next Temporal coordinator tick
>    (`signals-scout-coordinator-schedule`) — STEP 6's
>    `signals-scout-config-sync` materializes the troop immediately but doesn't
>    dispatch a run. Explore triggering an immediate coordinator run for this
>    team right after setup (e.g. an on-demand schedule trigger exposed as an
>    MCP tool the wizard calls in STEP 6), then update the outro/report copy.
>    **Partly unavoidable:** scouts still take a few minutes to actually run,
>    and warehouse-fed sources (GitHub / Linear / Zendesk issues) can't emit
>    until their first DWH sync completes (item 2) regardless of the coordinator
>    — so an immediate trigger speeds up scout findings, not source/warehouse
>    findings. Lands in posthog (the trigger) + context-mill (call it) + the
>    wizard outro copy.
> 4. Update the Inbox UI to propose running the wizard command for self-driving.
> 5. Record the demo and discuss the text with the team.

---

## 8. Local dev & reset

Run:
`POSTHOG_WIZARD_DEBUG=1 NODE_ENV=development pnpm try --install-dir=<test project> self-driving --local-context-mill --local-mcp`.
`--local-context-mill` points skills at the context-mill dev server
(`localhost:8765`) and `--local-mcp` points MCP at `localhost:8787`; OAuth at
the local PostHog (`localhost:8010`). Local team 1 is enrolled via the DEBUG
fallback (§6).

Each run mutates state (sources, troop, custom scouts, warehouse sources,
report), so re-testing needs a teardown. Use the dev-only posthog command (full
docs in `posthog/products/signals/ARCHITECTURE.md` → "Resetting self-driving
state for local re-testing"):

```text
python manage.py reset_signals_self_driving --team-id 1 --yes --install-dir <test project>
```

It deletes the team's sources, scout troop config, custom scouts (preserving
canonical/companion via the `seeded_by` marker), run-state, emitted findings
(via `cleanup_signals`), and **soft-deletes the self-driving-created warehouse
pipelines** (scoped to `created_via=MCP`), then removes the report and cycles
the wizard log. `DEBUG`-only. By default it leaves the **product toggles**
(replay / error tracking / conversations) alone — so a plain run resets _just_
self-driving state.

Add **`--reset-products`** to also handle the step-3 products: it reports their
state _before_ resetting, so it **doubles as a verifier** for the "Enable
products" step, then turns them back off.

**Smoke-test loop** (run the posthog commands from the `posthog/` repo root):

```text
# 1. Baseline — turn the products off (and clear all self-driving state).
python manage.py reset_signals_self_driving --team-id 1 --yes --reset-products

# 2. Run the wizard against your test project (it should enable the products in the Enable products step).
POSTHOG_WIZARD_DEBUG=1 NODE_ENV=development pnpm try --install-dir=<test project> self-driving --local-context-mill --local-mcp

# 3. Verify + reset for the next cycle. The report at the TOP of the output is the check:
python manage.py reset_signals_self_driving --team-id 1 --yes --reset-products
```

Step 3 prints, before it resets anything:

```text
Product enablement (should all be ON right after a self-driving run):
  ✓ Session Replay: ON
  ✓ Error Tracking: ON
  ✓ Support / Conversations: ON
```

If the wizard missed one, that line reads `✗ … : OFF` and a
`⚠ a self-driving run should have enabled, but didn't: …` summary follows —
that's the regression signal. To **check without resetting** (e.g. keep the
enabled state to inspect in the UI), run `--reset-products` **without `--yes`**:
the report prints first, then type anything other than `yes` at the confirmation
to abort before any teardown. Omit `--reset-products` entirely to reset just the
self-driving state and leave the products as they are.

---

## 9. Proactive product enablement (replay / error tracking / support)

> [!IMPORTANT]
>
> STEP 3 ("Enable products") turns PostHog products ON (so the signal sources
> have data to read) **before** sources are enabled. It spans the wizard,
> posthog and context-mill, and needs **no manual prod step**:
> `product_enablement` is a normal public scope object, so
> `product_enablement:write` is already inside the wizard apps' `@default`
> ceiling (§7 item 1). Code anchors: posthog
> `products/signals/backend/product_enablement.py` (+ `routes.py`,
> `posthog/scopes.py`, `products/signals/mcp/tools.yaml`); wizard
> `src/programs/self-driving/scopes.ts` + `prompt.ts`; context-mill
> `references/3-enable-products.md`. Symbol names are durable; `file:line`
> anchors can drift.

### 9.1 Decisions

- **The "Enable products" step** (STEP 3) runs after step 2 (_Read context_) and
  **before** STEP 4 (_Enable sources_). It turns on **Session Replay** + **Error
  Tracking** every run; **Support/Conversations** is flag-on + a report CTA only
  (9.4). Once products are on, STEP 4's "enable sources for products in use"
  rule picks them up.
- **One path for everyone.** No free/paid fork, no consent prompt, no
  per-framework skill fork.
- **No billing writes, and no $0 spend cap:** `custom_limits_usd` is org-wide,
  set via an `INTERNAL`-scoped endpoint (`ee/api/billing.py`) unreachable by any
  OAuth token, and a $0 cap _harms_ existing paying users (caps + drops data
  across all their projects; `ee/billing/quota_limiting.py`). `remote_config.py`
  even force-disables replay when recordings are quota-limited. Cost overruns
  are handled **reactively (refunds)** — a product decision.
- **Transparency + PII.** No prompt, but the **report/outro discloses** what was
  enabled, and the replay recipe sets a masking floor server-side. The floor is
  `{maskAllInputs: true}`, written **only when the team has none set**
  (apply-if-unset). posthog-js already masks all inputs + passwords by default,
  so this just persists that floor and never disables masking; on-page text
  stays visible so Signals can still read the recording. The recipe doesn't mask
  _all_ text (`maskTextSelector:"*"`): that can't be a true hard floor (client
  init wins over server) and would gut replay value. The recipe leaves
  `recording_domains` at its default of all domains (incl. production).
- **Web first.** A server-side flip only activates products for SDKs that read
  remote config (posthog-js). Backend/mobile need generated **code** → phase 2
  (9.6).

### 9.2 Write path — intent-based `products-enable`, NOT `project:write`

- **Not `project:write`:** it makes `ProjectViewSet` (a `ModelViewSet`,
  `scope_object="project"`) writable → authorizes `DELETE /api/projects/:id` +
  ~60 team fields incl. `access_control` (RBAC),
  `session_recording_masking_config` (PII), `app_urls`, `test_account_filters`
  (`posthog/api/project.py` `team_passthrough_fields`). Every _existing_ wizard
  write scope is a product-object write — none can delete the project or rewrite
  security/privacy config. It's also a **permanent, org-wide ceiling** change on
  a **public npm** tool (every external user grants it), and breaks
  self-driving's "read-only + narrow product writes" property.
- **Not per-product settings viewsets:** doesn't scale — each new product (logs,
  heatmaps, surveys…) = another viewset + tool + scope. (Precedent that _does_
  work this way: `ErrorTrackingSettingsViewSet`,
  `scope_object="error_tracking"`, in
  `posthog/products/error_tracking/backend/presentation/views/settings.py`.)
- **Chosen — one intent-based surface.**
  `products-enable {products: ProductKey[]}`, gated by **one** narrow scope
  **`product_enablement:write`**. The caller names _which_ products; the
  **server owns the recipe** per product (toggle + companion defaults). The
  caller passes **no field values**, so it cannot weaken masking or set bad
  limits. **Adding a product later = register a recipe + add an enum key** — no
  wizard/scope/ceiling change. Most enable-levers are flat Team opt-in bools in
  the same `team_passthrough_fields` list (`heatmaps_opt_in`, `surveys_opt_in`,
  `capture_console_log_opt_in`, `capture_performance_opt_in`,
  `autocapture_opt_out`, `session_recording_opt_in`,
  `autocapture_exceptions_opt_in`, `conversations_enabled`), so one surface
  covers them all.

### 9.3 Recipes (server-owned, posthog)

`ProductEnablementViewSet` (a plain `viewsets.ViewSet`,
`scope_object="product_enablement"`, `create`=POST so `product_enablement:write`
gates it automatically) iterates the requested keys → dispatches to a
per-product recipe in the `RECIPES` dict
(`products/signals/backend/product_enablement.py`). A dict, not per-module
registration — overkill for three recipes; add a key when a product is added.
Primary toggle is **always** set; companion settings applied **only if unset**
(never clobber a user's config); each recipe records the fields it touched and
the viewset does one `team.save(update_fields=...)` (Team `post_save` syncs
remote config). Recipes:

- `session_replay` → `team.session_recording_opt_in = True`; if
  `session_recording_masking_config` is null → `{maskAllInputs: true}` (the
  floor, 9.1). (`team.py:361`, `:387`.)
- `error_tracking` → `team.autocapture_exceptions_opt_in = True`. **No limits**
  — `ErrorTrackingSettings`' rate-limit fields are all nullable with no default
  and NULL _means_ "no limit", so there is nothing to seed. (`team.py:466`.)
- `conversations` → `team.conversations_enabled = True` + mint
  `conversations_settings.widget_public_token` (mirrors
  `handle_conversations_token_on_update`); `widget_enabled` stays false →
  tickets only after a channel is connected (the report CTA). (`team.py:438`.)

**Admin gate.** The error-tracking-style pattern (plain serializer, no model
instance) bypasses the `field_access_control(...,"admin")` field gate _and_ the
`TeamSerializer`'s `validate_team_attrs`, whose `TEAM_CONFIG_ADMIN_FIELDS_SET`
gate makes `conversations_enabled` / `conversations_settings` /
`session_recording_masking_config` **admin-only** on the normal
`PATCH /api/projects/:id`. Letting a non-admin member flip those here would be a
privilege escalation. So the viewset replicates that gate **precisely**: after
running recipes it computes `touched ∩ TEAM_CONFIG_ADMIN_FIELDS_SET` and, if
non-empty, requires `effective_membership_level >= ADMIN` (else 403) — exactly
`validate_team_attrs`. Member-safe fields (`autocapture_exceptions_opt_in`, the
replay opt-in itself) stay enable-able by any member, so an
`error_tracking`-only call works for members. The wizard's default 3-product
call includes `conversations`, so in practice it needs project admin; a 403 is a
recorded follow-up, not an abort.

### 9.4 Mechanism facts

- **Replay (web):** `session_recording_opt_in=true` → `remote_config.py:262`
  emits the `sessionRecording` block → posthog-js
  `isRecordingEnabled = window && serverEnabled && !disable_session_recording && !optedOut`
  → records **on next page load**. No code change for a default-config web SDK.
- **Error tracking (web):** `autocapture_exceptions_opt_in=true` →
  `remote_config.py:240` emits `autocaptureExceptions` → posthog-js hooks
  `window.onerror`/rejections (uses the remote flag when the client
  `capture_exceptions` is unset). No code change.
- **The step CHECKS (and edits) the init snippet:** if the wizard's posthog-js
  init set `disable_session_recording: true` / `capture_exceptions: false`, the
  client overrides the remote flag and the flip is **inert**. Phase 1 reads the
  init in the user's repo and edits it to not override (warlock/YARA scans apply
  to the edit). Snippet content lives in context-mill (off-disk).
- **Backend/mobile:** the Team flags are **inert** (no posthog-js to read them)
  → phase 2.
- **Conversations is inert as a flag flip:** the `conversations` signal source
  reads `Ticket` rows
  (`products/signals/backend/emission/fetchers/conversations.py`); tickets are
  created only by a connected channel — widget/email/Slack/Teams
  (`create_with_number`, `products/conversations/backend/signals.py:79`). So
  phase 1 = flip `conversations_enabled` (cheap, "eases the start") + enable the
  `conversations` `SignalSourceConfig` (already callable, `task:write`) + a
  **report CTA** ("connect a channel"). Real fix = the widget embed (phase 2).
  NB enabling auto-generates `widget_public_token` (`team.py:2367`) but leaves
  `widget_enabled=false`.

### 9.5 Framework coverage (90-day wizard telemetry, `internal-j`)

Break `wizard: setup confirmed` down by `properties.integration` (on the
terminal `setup wizard finished` event, `integration` is nested under
`properties.tags`). Buckets:

- **Web ~58%** (nextjs 41%, react-router, astro, tanstack-\*, vue, sveltekit,
  nuxt, angular, javascript_web) → **covered by the phase-1 server flip**
  (client replay + client errors).
- **Pure backend ~23%** (javascript_node **16.8%**, fastapi, python, flask,
  ruby) → flip is a **no-op**; needs code (phase 2).
- **Mobile ~14%** (react-native **10.1%**, swift, android) → no-op; SDK-init
  code (phase 2).
- **Hybrid ~3%** (laravel, django, rails) → partial (only if they load
  posthog-js). Undetected ~4%.

**Phase-2 priority is node-first** (16.8% — the single biggest slice the flip
misses), then react-native.

### 9.6 Phase 2 (planned — context-mill, no new posthog scope)

The backend/mobile lever is generated **code** (the agent already edits the
repo), so it's a context-mill skill change, not platform work:

- Backend error tracking, **node-first** → python/fastapi/flask → ruby/php:
  enable exception autocapture in the SDK init (e.g. python
  `enable_exception_autocapture=True`).
- Mobile (RN/swift/android): SDK-init replay + exception options
  (min-version-gated).
- **Support widget embed** (web): inject the widget snippet + `widget_enabled` →
  makes Conversations actually produce tickets (upgrades 9.4's CTA to
  auto-done).
- Server-side error tracking for full-stack web (e.g. Next.js API routes via
  posthog-node).

### 9.7 Where it lives, per repo

- **posthog.** `ProductEnablementViewSet` + `RECIPES`
  (replay/error-tracking/conversations) in
  `products/signals/backend/product_enablement.py`; route in
  `products/signals/backend/routes.py` (`signals/product_enablement`); scope
  object `product_enablement` in `posthog/scopes.py` (+ frontend `types.ts` /
  `scopes.tsx`); MCP tool `products-enable` in `products/signals/mcp/tools.yaml`
  (op `signals_product_enablement_create`, scope `product_enablement:write`).
  Admin-RBAC: project admin required only for admin-gated fields, mirroring
  `validate_team_attrs` (9.3). The MCP _generated_ artifacts
  (`services/mcp/src/tools/generated/*`,
  `schema/generated-tool-definitions.json`, `src/lib/oauth-scopes.generated.ts`)
  regenerate from the OpenAPI spec via `hogli build:openapi` →
  `pnpm --filter=@posthog/mcp generate-tools`, in posthog CI, not by hand.
- **OAuth ceiling — no action.** `product_enablement:write` is inside the
  `@default` ceiling the wizard apps use, so the consent server grants it with
  no edit (see §7 item 1 for the `@default` mechanics and how to verify).
- **wizard.** `product_enablement:write` in `SELF_DRIVING_SCOPE_ADDITIONS`
  (`self-driving/scopes.ts`); STEP 3 "Enable products" in `prompt.ts` (label
  mirrors the skill's `3-enable-products.md`); the README's "OAuth app scope
  ceiling" lists the scope. The platform (web vs backend/mobile) is left to the
  skill and the agent's repo read: `session.integration` is null on the common
  "PostHog already present" path, so `PromptContext` carries no framework
  family. The enable is harmless on backend/mobile (inert flags), and
  idempotency rides the `teamProductOptIns` read.
- **context-mill.** `references/3-enable-products.md` (after
  `2-read-context.md`, before `4-sources.md`, chained by `next_step`);
  `7-report.md` carries the "Products enabled" disclosure and the Conversations
  connect-a-channel CTA.

### 9.8 Open items

- **Logs** likely isn't a Team opt-in toggle (OTel ingestion, "on when data
  arrives") — verify before adding a recipe. Out of scope here.
- Idempotent enable; silent re-enable **will re-enable a setting a user turned
  off deliberately** (the flag default `False` can't distinguish "never set"
  from "off on purpose") — accepted under "enable everyone."
- Refund operational process (no consent, no cap).

---

## 10. Replay Vision scanners (step 6c)

The **push** layer of the inbox: scanners watch individual recordings and emit
what they see, where sources and scouts _pull_. **The wizard owns almost none of
it** — just the OAuth scope (§3) and the STEP that names the skill. The
skeletons, the per-product blanks the agent fills, the rules that keep the
scanners cheap and non-duplicative (query scoping, the disjoint-query
constraint, the quota sanity-check) all live in the skill
(`context-mill/.../6c-replay-vision-scanners.md`), so they can change without a
wizard release — which is the whole reason they live there and not here. Read
that file for the design; this section records only the facts that are about the
**wizard flow**, not the scanner content.

- **Scope.** Object is `replay_scanner` — the `vision-scanners-*` names are MCP
  _tools_, not scopes, so requesting a tool name grants nothing and the step
  403s. Create/update also need `session_recording:read` (the API pairs them —
  configuring a scanner indirectly exposes recording contents). Both are normal
  public objects inside the wizard apps' `@default` ceiling, so **no ceiling
  edit** (§3, §7 item 1). The one sequencing constraint: ship the wizard release
  (scope + STEP) **before** the context-mill `mcp-publish`, or a token predating
  the scope 403s — fixed by a reconnect, not a ceiling edit.

- **Self-authorizing → no source row.** `emits_signals` (a bool on
  `ReplayScanner`, default false) is the entire mechanism — no new contract,
  enum, or migration. `SignalSourceConfig.is_source_enabled` returns `True` for
  `replay_vision`/`scanner_finding` unconditionally, because the flag on the
  scanner _is_ the per-source config. That's why STEP 4 must **not** create a
  `replay_vision` source row.

- **Separate layer from the scout.** The scanner is the _sensor_ (one recording
  → one observation → the per-session finding). `signals-scout-replay-vision` is
  the _analyst_ reading **across** accumulated observations, left off by default
  and untouched here. Because 6c runs _after_ step 6 and its scanners have
  produced nothing yet, that scout stays an evidence-based no in step 6 — don't
  enable it on the strength of having just created scanners.

- **Never aborts.** No recordings yet (the scanners arm and start when
  recordings begin), a backend-only project, the `replay-vision` flag off
  (endpoints 404 behind `ReplayVisionEnabledPermission` — in practice on for
  everyone), a missing tool, or a single failed create are all recorded
  follow-ups, then step 7.

Code anchors: posthog `products/replay_vision/backend/models/replay_scanner.py`,
`api/scanners.py`, `temporal/scanners/prompts/signals_step.jinja` (the fixed
defect-detection turn that `emits_signals` appends — the _why_ the skill cares
more about a scanner's `query` than its prompt); wizard
`src/programs/self-driving/scopes.ts` + `prompt.ts` +
`src/tui/programs/self-driving/deck/tips.ts`; skill
`6c-replay-vision-scanners.md`.

---

## Cross-references

- Wizard design discipline: repo-root `CLAUDE.md`,
  `.claude/skills/wizard-development/`.
- Signals backend internals + the reset command in full:
  `posthog/products/signals/ARCHITECTURE.md`.
- Scout authoring:
  `posthog/products/signals/skills/authoring-signals-scouts/SKILL.md`.
- The setup skill: `context-mill/context/skills/self-driving/`. Security rules:
  the `warlock` repo.
