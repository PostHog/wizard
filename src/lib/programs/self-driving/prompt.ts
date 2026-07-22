import { AgentSignals } from '@lib/agent/agent-interface';
import type { PromptContext } from '@lib/agent/agent-runner';

/**
 * Build the self-driving run prompt. The installed
 * `self-driving-setup` skill is the source of truth for the HOW of
 * every step (which MCP tools to call, which sources/scouts apply, how
 * to verify); this prompt carries the order, the wizard-specific
 * mechanics (wizard_ask, abort signals), and the project URLs.
 *
 * Integration (when the project has no PostHog yet) runs as a separate phase
 * before this — the real integration program, with its own screens and task
 * list — so this prompt only covers the Self-driving steps.
 */
export function buildSelfDrivingPrompt(ctx: PromptContext): string {
  const uiHost = ctx.host.appHost.replace(/\/$/, '');
  const projectBase = `${uiHost}/project/${ctx.projectId}`;
  const integrationsSettingsUrl = `${projectBase}/settings/environment-integrations`;
  const orgAiSettingsUrl = `${uiHost}/settings/organization#organization-ai-consent`;
  const newWarehouseSourceUrl = `${projectBase}/pipeline/new/source`;
  const inboxUrl = `${projectBase}/inbox`;
  const optIn = (value: boolean | null | undefined): string =>
    value === true ? 'ON' : value === false ? 'OFF' : 'unknown';
  const optIns = ctx.teamProductOptIns;

  return `You are setting up PostHog Self-driving for this project: you will enable the right signal sources, make sure GitHub is connected, tune the scout troop, design custom scouts for what this product uniquely needs, and hand the user a configured inbox.

Project URLs:
- Integrations settings: ${integrationsSettingsUrl}
- Organization AI settings: ${orgAiSettingsUrl}
- New data warehouse source (Linear / Zendesk / GitHub issues / pganalyze): ${newWarehouseSourceUrl}
- Self-driving inbox: ${inboxUrl}

Project state read at auth time (PostHog project settings — authoritative
for whether a product is enabled, regardless of what this repo
instruments; products are often instrumented from other repos or the
snippet, so repo evidence may rule a product IN but never OUT):
- Session replay recording: ${optIn(optIns?.sessionReplay)}
- Exception autocapture (error tracking): ${optIn(optIns?.exceptionAutocapture)}
- Surveys: ${optIn(optIns?.surveys)}

The installed skill is the source of truth for the HOW of every step:
which MCP tools to call, which sources and scouts apply to this product,
and how to verify each change. The STEPS below give the order and the
wizard-specific mechanics — read the matching skill reference before
doing the work, and do not invent steps the skill doesn't describe.

Before doing any work, create your FULL task list in a single TaskCreate
call so the user can follow your progress in the TUI. Use exactly these
tasks, in this order:
  1. Check Self-driving access
  2. Read project and current Self-driving state
  3. Connect GitHub (required)
  3b. Enable products (replay, error tracking, support)
  4. Enable signal sources
  5. Offer issue-tracker integrations
  6. Configure the scout troop
  6b. Design custom scouts
  7. Write report and hand off
Drive the list with TaskUpdate — mark a task in_progress when you start
it and completed when done. If a step turns out to be a no-op (e.g.
GitHub is already connected), still mark its task completed.

Wizard mechanics:
- Ask the user things ONLY with the wizard_ask MCP tool, and batch
  related questions (e.g. one multi-select for all issue trackers, not
  one ask per tool). The per-run ask budget is limited.
- If wizard_ask is unavailable (CI / non-interactive), emit
  ${AgentSignals.ABORT} requires-interactive-mode and halt.
- When a step requires the user to do something in the browser, give
  them the exact URL inside the wizard_ask prompt text — do not try to
  open a browser yourself.
- Emit ${AgentSignals.STATUS} lines as you complete each step so the
  user sees progress.

Follow these steps IN ORDER. Do not skip or reorder.

STEP 1 — Check Self-driving access. (skill: "Check access")
   Self-driving is in open beta and available to every team, so there is
   no access gate to probe. Do NOT call any MCP tool here — mark this task
   in_progress and then completed right away and emit the
   ${AgentSignals.STATUS} line, so the user sees an immediate first step.
   Only if the Signals API later turns out to be genuinely unreachable for
   this project (a hard error on every Signals call, unexpected in open
   beta) should you emit
   ${AgentSignals.ABORT} self-driving is not available for this project
   and halt.

STEP 2 — Read project and current Signals state. (skill: "Read context")
   If ./posthog-setup-report.md exists, read it as a strong hint for what
   THIS repo instruments — but it is often absent (users frequently don't
   commit it), so do NOT depend on it. Combine whatever you find with the
   project-state block above and the skill's server-side usage probes —
   repo evidence rules products in, never out. Do a light scan ONLY for
   what neither covers. List the currently enabled signal sources so every
   later write is idempotent.

STEP 3 — Connect GitHub. REQUIRED. (skill: "Connect GitHub")
   Signals cannot research or fix issues without code access. Check for
   an existing GitHub integration first; if absent, send the user
   through the GitHub App connection via wizard_ask exactly as the skill
   describes (it builds the one-click authorize link), and verify the
   connection after they confirm. If the user cannot connect now, emit
   ${AgentSignals.ABORT} github connection declined
   and halt — never finish setup without GitHub.

STEP 3b — Enable products. (skill: "Enable products")
   Turn ON the PostHog products Signals reads from — Session Replay,
   Error Tracking, and Support — so the sources you enable next have data
   to read. These are server-side enables with conservative defaults
   (owned by the server, not you). The project-state block above covers
   only Session Replay and Error Tracking, so you can skip those if they
   are already ON; it does not show Support, but every enable is idempotent
   so enabling any of them again is safe regardless. For a web app, also
   make sure this repo's posthog-js
   init doesn't disable them; for a pure backend or mobile app the server
   flip is inert, so just record that for the report and move on. The skill
   names the exact tool and the per-platform detail.

STEP 4 — Enable signal sources. (skill: "Enable sources")
   Enable the sources that match what this product actually uses, per
   the skill. Never enable a source for a tool the user hasn't
   confirmed they use.

STEP 5 — Offer issue-tracker integrations. (skill: "Connected tools")
   One batched multi-select wizard_ask for the external tools the skill
   lists. The run auto-connects the ones it can (GitHub Issues, and
   Linear via a one-click OAuth link), verifying each with a single
   silent check — never nudge. For GitHub Issues: when the GitHub
   integration has exactly one repository connected, use that repo by
   default and skip repo research entirely — research which repo
   matches this project only when several are connected. It arms the
   rest as dormant responders to
   finish later: for tools it can't auto-connect (Zendesk, pganalyze) it
   never sends the user to paste credentials and never re-prompts. Enable
   a source only for a tool the user picked.

STEP 6 — Configure the scout troop. (skill: "Scouts")
   Materialize the troop, then enable only a small set — the "general"
   scout plus the one or two specialists for the products this project
   uses most — and disable the rest, per the skill. The whole enabled
   troop shares the project's allowance of up to 24 scout runs per day,
   and at the default hourly interval a single scout consumes all 24 —
   so set the run interval of every scout you enable so the troop's
   combined schedule stays within 24 runs per day, weighting runs
   toward the "general" scout.

STEP 6b — Design custom scouts for this product. (skill: "Custom scouts")
   You are the only actor that has read this repo — turn that into
   coverage per the skill: a real gap analysis of the project's
   watchable surfaces against what the built-in troop already covers,
   then custom scouts for the uncovered ones. Start the gap analysis
   from the repo's for-agents context when present (AGENTS.md,
   CLAUDE.md, ARCHITECTURE.md, .cursor/rules, agent-facing docs) — it
   is a maintained map of the product's surfaces and vocabulary, so
   read it before scanning source. Keep scout bodies
   high-level: describe the behavior and signal conditions to watch,
   referencing repo evidence by file/function name — never paste raw
   source, secrets, env values, or customer data into a scout body.
   Never edit built-in scout bodies. Propose all candidates in ONE
   batched wizard_ask
   before creating anything; the user declining everything (or finding
   no gap at all) is a valid outcome, not an abort. Custom scouts draw
   from the same 24-runs-per-day allowance as the built-in troop — when
   the user approves any, rebalance run intervals so the whole enabled
   troop still fits within it. Mark the task
   completed either way.

STEP 7 — Write the report and hand off. (skill: "Report")
   Write the report per the skill, including follow-ups for anything
   deferred. Tell the user findings will start appearing in their inbox
   at ${inboxUrl} within about 30 minutes.`;
}
