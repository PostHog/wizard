import { AgentSignals } from '@lib/agent/agent-interface';
import type { PromptContext } from '@lib/agent/agent-runner';
import { getUiHostFromHost } from '@utils/urls';

/**
 * Build the product-autonomy run prompt. The installed
 * `product-autonomy-setup` skill is the source of truth for the HOW of
 * every step (which MCP tools to call, which sources/scouts apply, how
 * to verify); this prompt carries the order, the wizard-specific
 * mechanics (wizard_ask, abort signals), and the project URLs.
 */
export function buildProductAutonomyPrompt(ctx: PromptContext): string {
  const uiHost = getUiHostFromHost(ctx.host).replace(/\/$/, '');
  const projectBase = `${uiHost}/project/${ctx.projectId}`;
  const integrationsSettingsUrl = `${projectBase}/settings/environment-integrations`;
  const orgAiSettingsUrl = `${uiHost}/settings/organization#organization-ai-consent`;
  const newWarehouseSourceUrl = `${projectBase}/pipeline/new/source`;
  const inboxUrl = `${projectBase}/inbox`;
  const optIn = (value: boolean | null | undefined): string =>
    value === true ? 'ON' : value === false ? 'OFF' : 'unknown';
  const optIns = ctx.teamProductOptIns;

  return `You are setting up PostHog Product Autonomy (Signals) for this project: you will enable the right signal sources, make sure GitHub is connected, tune the scout fleet, design custom scouts for what this product uniquely needs, and hand the user a configured inbox.

Project URLs:
- Integrations settings (GitHub App install): ${integrationsSettingsUrl}
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
  1. Check Product Autonomy access
  2. Read project and current Signals state
  3. Confirm AI data processing approval
  4. Connect GitHub (required)
  5. Enable signal sources
  6. Offer issue-tracker integrations
  7. Configure the scout fleet
  8. Design custom scouts
  9. Write report and hand off
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

STEP 1 — Check Product Autonomy access. (skill: "Check access")
   Probe the Signals API as the skill describes. If the API is not
   available for this project (permission or not-found errors), emit
   ${AgentSignals.ABORT} product autonomy is not available for this project
   and halt.

STEP 2 — Read project and current Signals state. (skill: "Read context")
   Read ./posthog-setup-report.md as ground truth for what THIS repo
   instruments. Combine it with the project-state block above and the
   skill's server-side usage probes — repo evidence rules products in,
   never out. Do a light scan ONLY for what neither covers. List the
   currently enabled signal sources so every later write is idempotent.

STEP 3 — Confirm AI data processing approval. (skill: "AI approval")
   The wizard's base AI opt-in gate already enforces organization AI
   data processing approval before this run starts, so it is guaranteed
   granted by the time you reach this step. Do NOT ask the user about it
   and do NOT abort — just record it as approved, per the skill.

STEP 4 — Connect GitHub. REQUIRED. (skill: "Connect GitHub")
   Signals cannot research or fix issues without code access. Check for
   an existing GitHub integration first; if absent, send the user to
   ${integrationsSettingsUrl} via wizard_ask and verify the connection
   after they confirm. If the user cannot connect now, emit
   ${AgentSignals.ABORT} github connection declined
   and halt — never finish setup without GitHub.

STEP 5 — Enable signal sources. (skill: "Enable sources")
   Enable the sources that match what this product actually uses, per
   the skill. Never enable a source for a tool the user hasn't
   confirmed they use.

STEP 6 — Offer issue-tracker integrations. (skill: "Connected tools")
   One batched multi-select wizard_ask for the external tools the skill
   lists. The run auto-connects the ones it can (GitHub Issues, and
   Linear via a one-click OAuth link) and arms the rest as dormant
   responders to finish later — it never sends the user to paste
   credentials in the browser, and never polls to confirm a connection.
   Enable a source only for a tool the user picked.

STEP 7 — Configure the scout fleet. (skill: "Scouts")
   Materialize the fleet and disable the scouts whose product surface
   this project lacks, per the skill.

STEP 8 — Design custom scouts for this product. (skill: "Custom scouts")
   You are the only actor that has read this repo — turn that into
   coverage per the skill: a real gap analysis of the project's
   watchable surfaces against what the canonical fleet already covers,
   then custom scouts for the uncovered ones. Never edit canonical
   scout bodies. Propose all candidates in ONE batched wizard_ask
   before creating anything; the user declining everything (or finding
   no gap at all) is a valid outcome, not an abort. Mark the task
   completed either way.

STEP 9 — Write the report and hand off. (skill: "Report")
   Write the report per the skill, including follow-ups for anything
   deferred. Tell the user findings will start appearing in their inbox
   at ${inboxUrl} within about 30 minutes.`;
}
