# Product Autonomy (Signals) Wizard Program — Implementation Plan & Handoff

> **Status:** Working/scratch doc. **Do not commit.** This is a self-contained handoff so a
> fresh agent/session can implement without re-researching. Written 2026-06-10.

---

## 0. TL;DR

Build a new **on-demand wizard program** named `product-autonomy` that, after a user has
onboarded PostHog, sets up **PostHog Signals** for their project:

- enables the right **Signals sources** (push feeds) for their product,
- connects the **GitHub integration** (code access Signals needs to research/fix issues),
- materializes + **tunes the Signals scout fleet** (pull agents) — turning off scouts
  irrelevant to the product,
- verifies/enables **org AI-data-processing approval**,
- writes a `posthog-product-autonomy-report.md`.

It is **agent-driven**: the product knowledge lives in a new **context-mill skill**
(`product-autonomy-setup`), not in wizard infra code. v1 spans three repos: **wizard**
(new program + OAuth scopes + a tiny deep-link tweak), **context-mill** (the skill), and
**posthog** (one small backend addition: an on-demand scout-config "sync" tool).

Later, this program becomes the **final step of the main wizard onboarding flow**.

---

## 1. Repos & where things live

| Repo | Local path | Role |
|---|---|---|
| **wizard** (this) | `/Users/woutut/Documents/Code/wizard` | The CLI. New program goes here. |
| **posthog** | `/Users/woutut/Documents/Code/posthog` | Signals backend (`products/signals/`), org/integration APIs, MCP tool defs. |
| **context-mill** | `/Users/woutut/Documents/Code/context-mill` | Source repo for wizard skills. New `product-autonomy` skill goes here. |
| **skills** | `/Users/woutut/Documents/Code/skills` | Published marketplace mirror of context-mill skills (generated; don't hand-edit). |
| **wizard-workbench** | (clone next to wizard) | Dev env: mprocs stack (context-mill dev + local MCP + wizard) + framework test apps. |

Signals architecture reference (read if you need depth):
`/Users/woutut/Documents/Code/posthog/products/signals/ARCHITECTURE.md` (1198 lines) and
`products/signals/{backend/scout_harness/AGENTS.md, skills/AGENTS.md, management/AGENTS.md}`.

---

## 2. Background — the Signals model (what we are configuring)

Signals groups "findings" from many products/integrations into **SignalReports** in the
inbox; reports can trigger agentic research + autonomy (coding tasks). Two distinct
enablement surfaces:

### 2.1 Sources (push) — `SignalSourceConfig`
Per-`(team, source_product, source_type)` rows that gate which products feed the inbox.
Model: `products/signals/backend/models.py:19-79` (`is_source_enabled` gate `:52-72`).
**Nothing is enabled by default** — a fresh team has zero rows.

- `SourceProduct` enum (`models.py:20-30`): `session_replay, llm_analytics, github, linear,
  zendesk, conversations, error_tracking, pganalyze, signals_scout, logs`
- `SourceType` enum (`models.py:32-41`): `session_analysis_cluster, evaluation, issue,
  ticket, issue_created, issue_reopened, issue_spiking, cross_source_issue, alert_state_change`

REST/MCP surface (`SignalSourceConfigViewSet`, `backend/views.py:182-281`; MCP defs
`products/signals/mcp/tools.yaml`): the `inbox-source-configs-*` tool family — `create`,
`list`, `retrieve`, `partial-update`, `update` (`destroy` disabled). **Scope object =
`task`** (a quirk — reuses the generic Tasks scope, NOT a signals-specific one), so a token
needs `task:read`/`task:write`.

Side effects on create/enable (`views.py:189-280`):
- `error_tracking/issue_created` enabled → fires `backfill-error-tracking` Temporal workflow.
- `session_replay/session_analysis_cluster` enabled → starts the clustering/summarization schedule; **create hard-requires org AI-approval** (`serializers.py:124-132`); injects `config.sample_rate=0.1` default (`serializers.py:135-143`).
- data-import sources (`github/linear/zendesk/pganalyze`) enabled → triggers external data sync, **no-op if no matching `ExternalDataSchema` exists** (i.e. row "enables" but produces nothing until the warehouse source is connected & syncing).
- Uniqueness `(team, source_product, source_type)` → duplicate create returns 400; switch to `partial-update {enabled:true}`.
- "Error tracking" in the product UI = **all three** of `issue_created/issue_reopened/issue_spiking` enabled together.

### 2.2 Scouts (pull) — `signals-scout-*` skills + `SignalScoutConfig`
Scheduled agents that scan a project and emit findings as `signals_scout/cross_source_issue`
signals. Driven by a Temporal **coordinator** (`backend/temporal/agentic/scout_coordinator.py`,
ticks every `COORDINATOR_INTERVAL_MINUTES=30`, `SKIP` overlap).

- **Team enrollment** = the `signals-scout` feature-flag JSON payload allowlist
  (`guaranteed_team_ids` minus `skip_team_ids`), read by `_enrolled_team_ids`
  (`scout_coordinator.py:230-263`). Fallback `DEFAULT_ENROLLED_TEAM_IDS=[1,2,148051]`
  (`:42`) only on Cloud/DEBUG. **Admin-only; no API/MCP path.** There is **no "all teams"
  mode** today (explicit id allowlist only).
- On a tick, for each enrolled team the coordinator calls `sync_canonical_skills(team)`
  (`lazy_seed.py:369`, mirrors the canonical `signals-scout-*` SKILL.md → per-team
  `LLMSkill` rows) then `_register_missing_configs(team)` (`scout_coordinator.py:266-284`,
  `get_or_create`s a `SignalScoutConfig` per scout: `enabled=True, emit=True,
  run_interval_minutes=60`).
- `SignalScoutConfig` model: `models.py:393-463` (defaults `:421-435`). Tunable fields:
  `enabled` (pause), `emit` (false = dry-run), `run_interval_minutes` (10–43200).
- Config API (`SignalScoutConfigViewSet`, `backend/scout_harness/views.py:491`): **only
  `list` (`:521`, `signal_scout:read`) + `partial_update` (`:539`, `signal_scout:write`)**.
  **No create endpoint.** `skill_name` is read-only (`serializers.py:843-846`).
  `partial_update` 404s on a missing row. → **a caller cannot create scout configs; only
  the coordinator/runner can.** This is the constraint that forces the backend change in §6.
- MCP tools (`mcp/tools.yaml`): `signals-scout-config-list` (`:185-186`),
  `signals-scout-config-update` (`:201-202`), plus `signals-scout-runs-{list,retrieve}`,
  `signals-scout-project-profile-get`, `signals-scout-scratchpad-search` (read);
  emit/scratchpad-write tools use `signal_scout_internal:write` (sandbox-only, NOT
  user-grantable — never needed by a setup program).
- Canonical fleet (10 scouts, `products/signals/skills/signals-scout-*/`): `general`,
  `error-tracking`, `ai-observability`, `logs`, `revenue-analytics`, `surveys`,
  `csp-violations`, `observability-gaps`, `anomaly-detection`, `health-checks`. Universal
  ones (general, error-tracking, anomaly-detection, observability-gaps, health-checks)
  self-close cheaply where their surface is absent; conditional ones (revenue, surveys,
  ai-observability, logs, csp) need the matching data.

### 2.3 Gates that silently break the outcome
- **Org `is_ai_data_processing_approved`** — `emit_signal` drops ALL signals if false
  (`backend/facade/api.py:140-148`). Org model `posthog/models/organization.py:214`
  (`default=True, null=True`; default flipped to True 2026-05-22 via migration 1177 — so
  *new* orgs are fine, older may be NULL/False). Both consumers fail-closed (only explicit
  True counts; MCP `services/mcp/src/lib/StateManager.ts:386-396`).
- **`product-autonomy` feature flag** — gates the whole Inbox UI
  (`frontend/src/scenes/inbox/InboxScene.tsx:741-762`, `signalSourcesLogic.ts:503-511`).
  For beta, assume on (set out-of-band).

---

## 3. Background — the wizard (just enough to build a program)

### 3.1 Program system
- `ProgramConfig` (`src/lib/programs/program-step.ts:110-182`): `command, id, skillId,
  steps, run, requires, reportFile, allowedTools, disallowedTools, cliOptions, mapCliOptions`.
- `ProgramRun` (`src/lib/agent/agent-runner.ts:83-116`): `integrationLabel, skillId,
  customPrompt, additionalMcpServers, spinnerMessage, successMessage, reportFile, docsUrl,
  abortCases, postRun, buildOutroData, maxQuestions`. `run` may be `ProgramRun` OR
  `(session)=>Promise<ProgramRun>` (dynamic).
- `ProgramStep` (`program-step.ts:55-102`): `id, label, screenId, show, isComplete, gate,
  onInit, onReady`. Headless step = no `screenId`. `onReady(ctx)` fires after the real
  session is assigned (has `installDir`); `onInit` fires too early (before session).
- `createSkillProgram` factory (`src/lib/programs/agent-skill/index.ts:53-76`): builds the
  common case with fixed steps `intro → health-check → auth → run → outro → skills`
  (`agent-skill/steps.ts`). Does NOT set allowedTools/disallowedTools/cliOptions — author by
  hand or post-process for those.
- Register in `PROGRAM_REGISTRY` (`src/lib/programs/program-registry.ts:42-56`) → derives
  `ProgramId` union (`:80`), screen-sequences, store gates. **CLI is NOT auto-derived** —
  also add `src/commands/<name>.ts` (see `src/commands/{revenue,audit,doctor}.ts`).
- `postRun(session, {accessToken, projectApiKey, host, projectId})`
  (`agent-runner.ts:486-493`) runs after a clean agent result, before the outro. (Note:
  no `cloudRegion` arg here — only `buildOutroData` gets it.)
- Pipeline: `runProgram` (`agent-runner.ts:178-526`) — OAuth `getOrAskForProjectData`
  (`:259-277` → `src/utils/setup-utils.ts:387-484`, returns `accessToken, projectApiKey,
  host, projectId, cloudRegion, roleAtOrganization, user`), skill install (`:286-301`),
  prompt assembly (`:368-373`), agent exec, abort handling (`:393-483`), postRun, outro.

### 3.2 Agent runtime + MCP (the key enabler)
- Runs the Claude Agent SDK; LLM via PostHog LLM gateway; model `claude-sonnet-4-6`.
- **PostHog product MCP is ALREADY attached to every program agent**: `mcpServers['posthog-wizard']`
  = `{ type:'http', url: mcp.posthog.com/mcp (or mcp-eu / localhost:8787 with --local-mcp),
  headers:{ Authorization: Bearer <OAuth access token> } }` (`agent-interface.ts:676-684`,
  url resolved `agent-runner.ts:308-313`). Tools surface as `mcp__posthog-wizard__<tool>`;
  schemas deferred via tool-search. `canUseTool`/`wizardCanUseTool` auto-allows all
  `mcp__posthog-wizard__*` (`agent-interface.ts:549-551`).
- **The ONLY gap for Signals is OAuth scope.** Scopes come from
  `getOAuthScopesForProgram(programId)` (base set `src/lib/constants.ts:113-136`; per-program
  additions `src/lib/oauth/program-scopes.ts`). Base set has NO `task`/`signal_scout`/
  `integration`/`organization` scopes. We add them (see §6).
- `wizard-tools` in-process MCP (`src/lib/wizard-tools.ts:1107-1122`): `check_env_keys,
  set_env_values, detect_package_manager, load_skill_menu, install_skill, audit_*,
  wizard_ask`. `wizard_ask` (`:953-1103`) = structured TUI prompts (per-run cap, can vault
  `sensitive` answers → `secretRef`).
- Browser-open + deep-link: `opn(url)` (e.g. `posthog-integration/index.ts:235`);
  `requestDeepLink(token, host)` (`src/utils/provisioning.ts:226-259`) POSTs
  `/api/agentic/provisioning/deep_links {purpose}` → returns a one-time login URL.
  The endpoint (`ee/api/agentic_provisioning/views.py:2089-2168`) accepts a free-form
  `purpose` + an optional **`path`** (any safe in-app relative path,
  `_is_safe_deep_link_path` `:2533-2544`) → user lands logged-in on that path. The helper
  currently hardcodes `{purpose:'dashboard'}` and sends no `path` → **needs a tiny tweak to
  forward `path`/`purpose`** so we can deep-link to integrations + org-AI settings.

### 3.3 Skills (context-mill)
- `ProgramConfig.skillId` is a string that must equal a `SkillEntry.id` in context-mill's
  `skill-menu.json` (fetched from GitHub Releases `latest/download`, or `localhost:8765`
  with `--local-mcp`). `installSkillById` (`wizard-tools.ts:143-166`) →
  `downloadSkill` curl|unzip into `<installDir>/.claude/skills/<id>/` + `.posthog-wizard`
  marker. Install command whitelist: `src/lib/skill-install.ts:10-21`.
- Context-mill skill source = `context/skills/<group>/{config.yaml, description.md,
  references/N-*.md}`. skillId scheme: variant `all` → `<group>`; else `<group>-<variantId>`.
  So group `product-autonomy` + variant `setup` → skillId **`product-autonomy-setup`**.
  Build `pnpm build` → zips + `skill-menu.json`; release uploads to GitHub Releases. Dev
  server `pnpm dev` serves `:8765`. No signals skill exists today.

### 3.4 Templates to copy
- **`web-analytics-doctor`** (`src/lib/programs/web-analytics-doctor/`) — best base:
  createSkillProgram + headless `detect` step + abortCases + `requires:['posthog-integration']`,
  reads project → acts via MCP → writes report.
- **`error-tracking-upload-source-maps`** (`.../index.ts:30-93`, `prompt.ts`) — dynamic
  `run`, `customPrompt`, `postRun`, parameterized MCP-driving prompt builder, custom
  intro/outro screens, browser-open patterns.
- **`audit`** (`.../{index,seed,types}.ts` + `src/ui/tui/screens/audit/AuditRunScreen.tsx`)
  — optional live "checks ledger" run screen via `seedAuditLedger` + a file watcher.
- **`revenue-analytics`** (`.../{index,steps,detect}.ts`) — detect step + typed
  `detectError` + custom intro that renders prerequisite errors + abortCases.

---

## 4. Verified facts (do NOT re-research)

1. **PostHog MCP is reachable from every wizard program agent**; only OAuth scope blocks
   Signals calls. (§3.2)
2. **Signal SOURCES are fully programmable** via `inbox-source-configs-*` (`task:write`).
   Source create does NOT validate integration existence — DW-backed sources create a dead
   row that no-ops until the warehouse source is connected. (§2.1)
3. **Scout CONFIGS cannot be created on-demand today** (no create endpoint; coordinator/
   runner-only). → requires the backend `config-sync` tool (§6.1). (§2.2)
4. **Scout enrollment is admin-only** (flag payload); **no "all teams" mode** exists.
   For beta, the Signals team enables flags out-of-band for ~100 hand-picked teams. The
   program ASSUMES it runs on an already-enrolled team and does NOT touch enrollment.
5. **Org AI-approval**: wizard does not set/require it; program can flip it via
   `PATCH /api/organizations/{id}/ {is_ai_data_processing_approved:true}` IF token has
   `organization:write` AND user is org admin (`OrganizationAdminWritePermissions`,
   `posthog/permissions.py:139-164`; PATCH `posthog/api/organization.py:456`, writable
   field `:283`). No MCP write tool. Non-admins → deep-link to Settings → Org → AI
   (`frontend/.../OrgAI.tsx:23`). (§2.3)
6. **GitHub: integration ≠ source.** The *integration* (`Integration kind="github"`, a
   GitHub App install — `posthog/models/integration.py:148,161,2358`) grants **code access**
   used by Signals repo selection/research/autonomy
   (`products/signals/backend/temporal/agentic/select_repository.py:49-54,134-152`). The
   `github/issue` *signal source* is a separate `ExternalDataSource` (warehouse issues feed).
   We care primarily about the **integration**.
   - Connect: deep-link to `/settings/environment-integrations` (`SettingsMap.tsx:1416`),
     which redirects to the GitHub App install. (Backend can also mint the install URL via
     `/api/integrations/authorize?kind=github` `posthog/api/integration.py:666-677`, or
     `/api/users/@me/integrations/github/start/` `posthog/api/user_integration.py:287-350`.)
   - Check "connected yet?": MCP tool **`integrations-list`** (ENABLED, `integration:read`,
     `products/integrations/mcp/tools.yaml:139-161`) → look for `kind:"github"`. Poll with
     skip/timeout. (The github-*start* MCP tools exist but are `enabled:false`.)
   - Needs wizard scope `integration:read`.
7. **`task` scope quirk**: signal source config API is permissioned under `scope_object="task"`,
   so enabling sources needs `task:read`/`task:write` (unrelated to the Tasks product).

---

## 5. Decisions (FINAL)

- **Program id/dir/files `product-autonomy`; CLI command `autonomy`** (users run
  `wizard autonomy`). Context-mill skill `product-autonomy-setup`. Report file
  `posthog-product-autonomy-report.md` (agent-written — see §7 step 7).
- **Product terminology:** the product UI calls sources **"Responders"** ("watching" =
  enabled, "Standby/Connect" = needs an integration, "Open" = internal). This program
  automates configuring that Responders screen + the scout fleet.
- **Agent-driven** via the context-mill skill (not host code).
- **Scope (v1):** sources + GitHub integration connect + scout fleet sync & tuning +
  AI-approval flip-or-guide. **Bespoke per-product scout authoring deferred to v2.**
- **Scouts:** add backend `signals-scout-config-sync` so the program can materialize the
  fleet, then **enable defaults → disable irrelevant scouts** → ready immediately after the
  run (first scan fires on the next coordinator tick, ≤30 min, because fresh configs are
  `last_run_at=None` = due-now). NO "run now" (Solution B) in v1.
- **Enrollment:** assumed (beta flags pre-set out-of-band). NO coordinator change.
- **GitHub is MANDATORY** — Signals can't research/fix without a repo. The program checks
  `integrations-list` for an existing team `kind:"github"` integration; if absent it requires
  the connect flow and blocks until connected. The only escape is an explicit "can't connect
  now → exit" that ABORTS the program (never completes setup without GitHub).
- **AI-approval:** flip directly if user is admin (after `wizard_ask` consent), else
  deep-link to org AI settings. Add `organization:write`.
- **Sources = the product's "Responders"** (each a `SignalSourceConfig`). V1 set, from the
  Responders screen:
  - **PostHog-native, conditional on the setup report / product use:** Error Tracking
    (`error_tracking` ×3, if set up), Session Replay (`session_analysis_cluster`, if replay
    used + AI-approved), Support (`conversations/ticket`, if they use PostHog support).
  - **Connected tools, ask-then-connect (never blind):** GitHub Issues (`github/issue`),
    Linear (`linear/issue`), Zendesk (`zendesk/ticket`), pganalyze (`pganalyze/issue`).
  - **Internal gate, always on (not a user-facing responder):** `signals_scout/cross_source_issue`
    — lets the scout fleet's findings reach the inbox.
  - **SKIP** AI Observability (`llm_analytics`, internal-only). **DROP** `logs` (not a V1
    responder).
  - **Note:** the Responders screen is *sources only*. Scouts are the separate pull surface
    (§7 step 6) — sync the full canonical fleet, then disable the ones irrelevant to the product.

---

## 6. Implementation plan

### 6.1 PostHog backend (one small, idempotent addition)
Add an on-demand scout-config sync so the wizard can materialize the fleet:
- New action on `SignalScoutConfigViewSet` (`products/signals/backend/scout_harness/views.py`):
  `@action(detail=False, methods=["post"], url_path="sync")` `sync()` (scope
  `signal_scout:write`) that, for the request's team, calls the EXISTING idempotent
  `sync_canonical_skills(team)` (`lazy_seed.py:369`) then `_register_missing_configs(team)`
  (`scout_coordinator.py:266-284`), then returns the configs (reuse the list serializer).
  Guard like the project-profile build does (it gates table-writing work behind a scope).
- Register the route (`backend/routes.py`) and expose the MCP tool
  **`signals-scout-config-sync`** in `products/signals/mcp/tools.yaml` (`signal_scout:write`).
- Tests: mirror `backend/test/test_signal_source_config_api.py` patterns; assert sync is
  idempotent and creates rows for a fresh enrolled team. (No Temporal workflow/activity list
  change → `test_module_integrity.py` untouched.)

> Why minimal: `sync_canonical_skills` + `_register_missing_configs` already exist and are
> idempotent; we only add an on-demand, team-scoped HTTP/MCP entry point into them.

### 6.2 Wizard
1. **OAuth scopes** — `src/lib/oauth/program-scopes.ts`: add
   `PRODUCT_AUTONOMY_SCOPE_ADDITIONS = ['task:read','task:write','integration:read',
   'signal_scout:read','signal_scout:write','organization:write','feature_flag:read']`
   (`feature_flag:read` = precondition flag checks in `detect`), wired into
   `getOAuthScopesForProgram` for the new program id. If the program is ever used on the
   signup/provisioning path, also add these to `WIZARD_PROVISIONING_SCOPES`
   (`src/lib/constants.ts:113-121`) AND the backend `ALLOWED_PROVISIONING_SCOPES` allowlist.
2. **Deep-link tweak** — `src/utils/provisioning.ts` `requestDeepLink(token, host, opts?)`:
   forward optional `{ purpose?, path? }` to the POST body (backend already supports `path`).
3. **Program** — `src/lib/programs/product-autonomy/`:
   - `index.ts`: `createSkillProgram({ skillId:'product-autonomy-setup', command:'autonomy',
     id:'product-autonomy', integrationLabel:'product-autonomy-setup',
     successMessage, reportFile:'posthog-product-autonomy-report.md', docsUrl, spinnerMessage,
     estimatedDurationMinutes, requires:['posthog-integration'] })`, then customize:
     `disallowedTools:[wizardAsk]`? — **NO**, we need `wizard_ask` (GitHub/Linear prompts), so
     leave it enabled; keep `allowedTools:['Agent']` if subagents wanted. Use a dynamic `run`
     if the prompt needs detect results (GitHub poll URL, etc.) — model on
     `error-tracking-upload-source-maps/index.ts:30`.
   - `steps.ts`: prepend a headless `detect` step (`onReady`) to the generic skill steps.
   - `detect.ts`: verify preconditions and abort cleanly if any fail — `posthog-setup-report.md`
     present (PostHog installed), the team's **`product-autonomy`** access flag on, and the
     **`signals-scout`** enrollment flag on (read via `feature_flag:read`). Typed `detectError`
     + `PRODUCT_AUTONOMY_ABORT_CASES` (`posthog not installed`, `not enrolled in product
     autonomy beta`).
4. **Register** — `program-registry.ts` (`PROGRAM_REGISTRY` + `Program` alias) and
   `src/commands/product-autonomy.ts` (CLI subcommand; model on `src/commands/revenue.ts`).
5. *(optional, P4)* custom run screen with a live "what got enabled" ledger (audit pattern).
6. **keep-skills step:** the generic flow ends with a keep/remove-skills screen (offers to
   keep the wizard-installed skill in `.claude/skills/`). This is a transient *orchestration*
   skill the user won't reuse, so default to **removing** it — drop the `skills` step from this
   program's step list (or auto-clean) rather than prompting a keep/remove choice. (Contrast:
   integration skills like the Next.js one are worth keeping; this one isn't.)

### 6.3 context-mill
New skill `context/skills/product-autonomy/`:
- `config.yaml`: `type: skill`, `template: description.md`, `tags: [signals, product-autonomy]`,
  `variants: [{ id: setup, display_name: "PostHog Product Autonomy" }]`, plus relevant
  `shared_docs` (signals docs).
- `description.md`: SKILL.md body (workflow skill → use `{workflow}` + `{references}`).
- `references/N-*.md`: the workflow steps (§7). Chain with `next_step:` frontmatter.
- Build/serve via `pnpm dev` (:8765) for local testing; release for prod.

---

## 7. The skill workflow (what the agent does, in order)

0. **Preconditions (headless `detect` step, before the run).** Abort with a friendly screen
   if any fail: PostHog not installed (`posthog-setup-report.md` absent), the team's
   **`product-autonomy`** access flag off, or the **`signals-scout`** enrollment flag off
   (checked via `feature_flag:read`). These are the `PRODUCT_AUTONOMY_ABORT_CASES`.
1. **Read context (trust the report, don't overscan).** Read `posthog-setup-report.md` as
   ground truth for what was instrumented (events, error tracking, replay). Light scan only
   for what the report won't cover (e.g. a payment SDK). `inbox-source-configs-list` for the
   already-enabled state; `signals-scout-project-profile-get` opportunistically (may 404 —
   tolerate).
2. **AI-approval.** Read org `is_ai_data_processing_approved`. If false: org admin →
   `wizard_ask` consent → `PATCH /api/organizations/{id}/`; else → deep-link to Settings →
   Org → AI (PATCH also 403s for non-admins → fall back to the link).
3. **GitHub integration — MANDATORY.** `integrations-list`: if a team `kind:"github"`
   integration already exists, note it and continue. If not, explain it's required,
   deep-link to `/settings/environment-integrations`, `opn()` it, and poll until connected.
   The only escape is an explicit "can't connect now → exit" that ABORTS the program (no
   half-finished setup).
4. **Enable native Responders** (`inbox-source-configs-create`; on the uniqueness 400 →
   `partial-update`): always `signals_scout/cross_source_issue` (scout gate); Error Tracking
   (`error_tracking` ×3) if set up; Session Replay (`session_analysis_cluster`) if replay
   used + AI-approved; Support (`conversations/ticket`) if they use PostHog support. Skip AI
   Observability (`llm_analytics`); no `logs`.
5. **Connected-tool Responders (ask-then-connect).** `github/issue`, `linear`, `zendesk`,
   `pganalyze`: `wizard_ask` "do you use X?" → if yes, deep-link them to connect the
   warehouse source → enable the responder once connected; else skip. Never enable blindly.
6. **Scouts.** `signals-scout-config-sync` (materialize the fleet for this team) →
   `signals-scout-config-list` → `signals-scout-config-update {id, enabled:false}` for each
   scout whose surface the product lacks; keep the universal ones on. Result: fleet
   configured & ready after the run; first scans fire on the next coordinator tick.
7. **Report + deep link.** The skill's **final reference step instructs the agent to write
   `posthog-product-autonomy-report.md` to the project root** — exactly like
   `posthog-setup-report.md` (agent-written; the program's `reportFile` field surfaces it in
   the outro and the screens point the user to it). Contents: enabled responders, scout
   posture, GitHub status, follow-ups. Emit `[SIGNALS_URL] <inbox url>` for the outro deep
   link.

---

## 7.5 User experience (program run; user already onboarded PostHog; beta team)

1. **Launch** — `wizard autonomy` in the project dir (later: auto-runs as the final
   onboarding step).
2. **Intro** — "Set up PostHog Product Autonomy — turn on Signals so PostHog automatically
   finds (and can fix) issues in your product." → Continue.
3. **Health check** — services-up (silent if green).
4. **Auth** — OAuth login (or reuse an existing login), select the project.
5. **Detect (headless)** — aborts with a clear screen if PostHog isn't installed or the
   `product-autonomy` / `signals-scout` flags aren't enabled for the team.
6. **Run** (agent + skill, live status lines):
   - **AI processing:** admin → "Enable AI data processing? (required for Signals)" → confirm
     → enabled; non-admin → shows the org-AI settings link.
   - **GitHub (mandatory):** if a team github integration already exists, continue; else
     "Signals needs GitHub access to investigate and fix issues" → opens browser → user
     installs the GitHub App → wizard detects it (or "can't connect now → exit" aborts).
   - **Native responders:** "Enabled Error Tracking and Session Replay" (only what the app has).
   - **Connected tools:** "Do you use Linear / Zendesk / pganalyze?" → connect-then-enable, else skip.
   - **Scouts:** "Configured your scout fleet; turned off the ones that don't apply to your product."
7. **Outro** — "Product Autonomy is on. PostHog will start scanning within ~30 min and surface
   findings in your inbox." → inbox deep link; report at `./posthog-product-autonomy-report.md`.
8. **Keep-skills** — default: remove the transient setup skill (see §6.2).

Downstream (not part of the program): findings land in the inbox over the next coordinator
ticks; immediately-actionable ones can auto-start coding tasks (PRs) via autonomy.

## 8. Build sequence (each phase independently testable)

| Phase | Deliverable | Repos | Ships alone? |
|---|---|---|---|
| **P0 Plumbing** | Program scaffold (registry, CLI, scopes, `requestDeepLink` tweak) + stub skill that reads the report and writes a trivial report. Verify `pnpm try --install-dir=<app> autonomy --local-mcp` runs e2e and the agent reaches PostHog MCP. | wizard + context-mill | verifies plumbing |
| **P1 Native sources** | Steps 1–3 (read, AI-approval flip/guide, native source enablement) + report. | wizard + context-mill | ✅ |
| **P2 Integrations** | Steps 4–5 (GitHub connect + poll; ask-then-connect DW sources). | wizard + context-mill | ✅ |
| **P3 Scouts** | Backend `signals-scout-config-sync` tool + step 6 (sync → tune). | **posthog** + context-mill | the cross-repo piece |
| **P4 Polish + fold-in** | Live run-screen ledger, abort cases, then make this the final step of the main onboarding flow. | wizard | — |
****
Verify after each wizard change: `pnpm build && pnpm test && pnpm fix`.

---

## 9. Local testing recipe (manual runbook)

Two viable setups. **(A)** is faster for the wizard/skill loop; **(B)** is needed to drive the
scout coordinator end-to-end. The wizard-workbench dev stack uses **`phrocs`** (not mprocs)
over sibling repos and serves **context-mill on :8765** + the **MCP on :8787**; `--local-mcp`
makes the wizard use both. (The stack runs context-mill + wizard + MCP — it does NOT itself
run the PostHog backend; that's separate, see B.)

### One-time
- **wizard-workbench:** on a clean machine `cd wizard-workbench && bash fresh-setup` (clones
  `context-mill`/`wizard`/`posthog` as siblings, writes `.env`, installs deps). If repos
  already exist, point `wizard-workbench/.env` at them manually (see its README).
- **Test app:** a sample app already PostHog-onboarded (the music pet app, or a
  `wizard-workbench/apps/...` app run through `posthog-integration` first so
  `posthog-setup-report.md` exists). Its PostHog project must live on the instance the MCP
  points at (cloud for A, local for B).

### Setup A — MCP → a real cloud PostHog project (fastest; P0–P2 + scout tuning)
Your team is a beta team, so the Signals team has already enabled its flags — you skip the
flag work. Point `wizard-workbench/.env`'s MCP at cloud, start the `phrocs` stack, run the
wizard. Caveat: you can't run the scout coordinator yourself — observe scouts in the cloud inbox.

### Setup B — full local PostHog (needed to drive scouts end-to-end)
1. **Start PostHog** — `cd posthog && ./bin/start` (Django API + frontend + deps; `hogli start`
   is the newer wrapper — confirm in the posthog README).
2. **Start the Signals Temporal worker** — `cd posthog && bin/temporal-django-worker` (signals
   workflows run on `VIDEO_EXPORT_TASK_QUEUE`; the `debugging-signals-pipeline` skill covers
   worker + pipeline details). Required for scouts to dispatch.
3. **Point the workbench MCP at local** and start the `phrocs` stack.
4. **Enable the beta gates for your test team** — easiest: use **local team 1 or 2**
   (auto scout-enrolled via `DEFAULT_ENROLLED_TEAM_IDS` in DEBUG):
   - `product-autonomy` flag → enable for the team in the local Feature Flags UI (gates Inbox UI).
   - `signals-scout` enrollment → team 1/2 auto-enrolled; else set the flag payload
     `{"guaranteed_team_ids":[<team_id>]}`.
   - Org AI-approval → set `organization.is_ai_data_processing_approved=True` (Org Settings →
     AI, or a Django shell `Organization.objects.filter(id=...).update(is_ai_data_processing_approved=True)`).
5. **Materialize scouts to tune** (until P3's sync tool ships) —
   `cd posthog && python manage.py sync_signals_scout_skills --team-id <N>`; watch one fire with
   `run_signals_scout`.
6. **For P3:** rebuild the local MCP (`posthog/services/mcp`) so it includes the new
   `signals-scout-config-sync` tool before testing the scout-tuning step.

### Run the wizard (either setup)
`cd wizard && pnpm try --install-dir=<app> autonomy --local-mcp`
(or `pnpm dev` to link `wizard` globally, then `wizard autonomy --local-mcp`).

### Verify
- Sources: `GET /api/projects/{id}/signals/source_configs/` or the Inbox "Edit sources"
  (Responders) modal.
- Scouts: `signals-scout-config-list` (via MCP) + run rows via the coordinator / mgmt cmds.
- Report file `posthog-product-autonomy-report.md` in the app root.

### Known caveat
GitHub App install needs `GITHUB_APP_SLUG` set in local dev (often unset) — the
detect/guide/poll logic is testable locally, but a real connection may need cloud.

---

## 10. Open items / risks

- **🚨 LAUNCH BLOCKER — cloud OAuth app scope ceiling (found during e2e 2026-06-11):**
  `wizard autonomy` fails at consent with `invalid_scope` until the five new scopes are added
  to the wizard OAuth app's `OAuthApplication.scopes` ceiling on **both** cloud regions:
  `task:read, task:write, integration:read, signal_scout:read, signal_scout:write`.
  - US `client_id=c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM`,
    EU `client_id=bx2C5sZRN03TkdjraCcetvQFPGH6N2Y9vRLkcKEy` (see `src/lib/constants.ts:88-90`).
  - Via Django admin (`/admin/posthog/oauthapplication/`) or prod shell, **additive**:
    `app.scopes = sorted(set(app.scopes) | NEW); app.save(update_fields=["scopes"])`.
  - All five are in `UNPRIVILEGED_SCOPES`, so widening is safe any time before launch and
    changes nothing for existing programs (programs only request what their config lists).
  - Local-dev variant of the same failure: a stale demo OAuth app row with an empty `scopes`
    ceiling (seeded before the widening fix in `posthog/demo/products/hedgebox/matrix.py:~1797`)
    → re-apply the seed expression to the existing row (fixed on this machine 2026-06-11).
- **P3 ordering:** the `signals-scout-config-sync` backend tool must be deployed (or running
  locally) before the wizard's scout step works. P1/P2 have no backend dependency.
- **context-mill release ordering:** the wizard can only install `product-autonomy-setup`
  once it's in `skill-menu.json` — iterate locally with the dev server + `--local-mcp`; only
  cut a context-mill release when P1+ is stable.
- **Open beta later:** when beta widens, the `signals-scout` "all teams" enrollment is a
  separate Signals-team backend change (not in this plan). The program is unaffected (it
  assumes enrollment).
- **GitHub local testing** needs `GITHUB_APP_SLUG`.
- **AI-approval flip** only works for org admins; non-admins get the guided link.
- **Provisioning/signup path** would need the new scopes added to the provisioning allowlist.

---

## 11. Key file reference index

**Wizard** (`/Users/woutut/Documents/Code/wizard`):
- Program types: `src/lib/programs/program-step.ts:55-182`; `src/lib/agent/agent-runner.ts:69-116`
- Factory: `src/lib/programs/agent-skill/index.ts:53-76`; steps `agent-skill/steps.ts`
- Registry: `src/lib/programs/program-registry.ts:42-80`; CLI `src/commands/{revenue,audit}.ts`
- Runner/MCP: `src/lib/agent/agent-runner.ts:178-526` (postRun `:486-493`, mcp url `:308-313`);
  `src/lib/agent/agent-interface.ts:676-700` (MCP wiring), `:549-551` (allow MCP), `:884-889`
  (tool resolution), `:1107-1122` (wizard-tools)
- Prompt: `src/lib/agent/agent-prompt.ts:15-63`
- Scopes: `src/lib/constants.ts:62-74,113-136`; `src/lib/oauth/program-scopes.ts`
- Deep link / opn: `src/utils/provisioning.ts:226-259`; `posthog-integration/index.ts:228-238`
- Skills: `src/lib/wizard-tools.ts:59-166,694-787`; `src/lib/skill-install.ts:10-21`
- Templates: `src/lib/programs/{web-analytics-doctor,error-tracking-upload-source-maps,audit,revenue-analytics}/`
- Setup report constant: `src/lib/programs/posthog-integration/index.ts:39`

**PostHog Signals** (`/Users/woutut/Documents/Code/posthog/products/signals`):
- Models: `backend/models.py:19-79` (source), `:393-463` (scout config)
- Source viewset/serializer: `backend/views.py:182-281`; `backend/serializers.py:37-143`
- Emit gate: `backend/facade/api.py:140-148`
- Scout config viewset/serializer: `backend/scout_harness/views.py:491,521,539`;
  `backend/scout_harness/serializers.py:836-871`
- Coordinator/seed: `backend/temporal/agentic/scout_coordinator.py:42,169,230-284`;
  `backend/scout_harness/lazy_seed.py:369,405-416`; `backend/scout_harness/runner.py:94,103,314`
- MCP tools: `mcp/tools.yaml` (inbox-source-configs-*, signals-scout-config-{list,update})
- Routes: `backend/routes.py`; mgmt cmds `backend/management/commands/{sync_signals_scout_skills,run_signals_scout}.py`
- Scout skills: `skills/signals-scout-*/SKILL.md`; `skills/AGENTS.md`; `backend/scout_harness/AGENTS.md`
- Architecture: `ARCHITECTURE.md`

**PostHog core** (`/Users/woutut/Documents/Code/posthog`):
- Org: `posthog/models/organization.py:214`; `posthog/api/organization.py:283,456,480-494,587`;
  `posthog/permissions.py:139-164`; `frontend/src/scenes/settings/organization/OrgAI.tsx:23`
- GitHub integration: `posthog/models/integration.py:148,161,2358-2390,2476-2482`;
  `posthog/api/integration.py:666-677`; `posthog/api/user_integration.py:287-350`
- Integration MCP tools: `products/integrations/mcp/tools.yaml:139-161` (integrations-list)
- Deep links: `ee/api/agentic_provisioning/views.py:2089-2168,2533-2556`
- Scopes: `posthog/scopes.py:91-136`; OAuth preset `posthog/temporal/oauth.py:30`
- MCP AI gate: `services/mcp/src/lib/StateManager.ts:386-396`

**context-mill** (`/Users/woutut/Documents/Code/context-mill`):
- Build: `scripts/build.js`; `scripts/lib/skill-generator.js` (id scheme), `build-phases.js`
- Example skills: `context/skills/{events-audit,error-tracking,revenue-analytics}/`
