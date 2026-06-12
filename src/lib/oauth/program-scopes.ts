/**
 * OAuth scope resolver — every program starts from the shared
 * `WIZARD_OAUTH_SCOPES` base set and a program can layer additional
 * scopes on top via `PROGRAM_SCOPE_ADDITIONS`.
 *
 *   final scope set = WIZARD_OAUTH_SCOPES ∪ programAdditions
 *
 * Additions are merged in declaration order and deduped, so a program
 * never accidentally weakens the base set — only widens it. Programs
 * not listed in `PROGRAM_SCOPE_ADDITIONS` request the unchanged
 * base set, exactly like before.
 *
 * Current additions: `McpTutorial` layers read-only on every product
 * surface (feature flags, experiments, surveys, replays, errors, web
 * analytics, LLM analytics, cohorts, persons) plus read/write on
 * annotations; `AgentSkill` adds feature-flag read/write; the default
 * `PostHogIntegration` run adds `integration:read` for the
 * Connect-Slack step. Persistence writes (dashboard:write,
 * insight:write, notebook:write, query:read) come for free from the
 * base set, so the tutorial's "save as insight / pin to dashboard /
 * add to notebook" follow-ups keep working.
 *
 * Add a new program override by extending `PROGRAM_SCOPE_ADDITIONS`
 * below — no other call-site changes required as long as the program's
 * `programId` is threaded into `getOrAskForProjectData`.
 */

// IMPORTANT: type-only import. A value import would create a circular
// dependency (setup-utils → program-scopes → program-registry →
// posthog-integration → ... → setup-utils), and `Program` would be
// read as `undefined` at module init. Keep this type-only and reference
// program IDs by their string-literal value below — TypeScript still
// catches renames via the `Partial<Record<ProgramId, ...>>` keying.
import type { ProgramId } from '@lib/programs/program-registry';
import { WIZARD_OAUTH_SCOPES } from '@lib/constants';

/**
 * Extra scopes the MCP tutorial needs on top of `WIZARD_OAUTH_SCOPES`.
 *
 * Every scope requested here must stay within the wizard OAuth app's
 * ceiling on the PostHog side (`OAuthApplication.scopes`) — the full
 * list lives in the README under "OAuth app scope ceiling". The
 * tutorial's prompts and follow-ups touch most of the read surface,
 * plus annotation write for the "PostHog wizard install" verify-prompt.
 *
 * Already in the base `WIZARD_OAUTH_SCOPES` (and therefore not
 * repeated here):
 *   • user:read, project:read, llm_gateway:read   — auth + gateway
 *   • query:read                                  — HogQL
 *   • dashboard:write, insight:write, notebook:write  — Phase-5 persist
 *
 * Deliberately omitted (writes on read-only product surfaces):
 *   • feature_flag:write, experiment:write, survey:write,
 *     cohort:write, session_recording:write, error_tracking:write,
 *     alert:write, subscription:write
 */
export const MCP_TUTORIAL_SCOPE_ADDITIONS = [
  // Explicit reads on the persistence surfaces. `*:write` usually
  // implies read on PostHog, but the consent flow grants exactly the
  // strings requested — explicit reads avoid a 403 when the agent
  // lists existing dashboards/insights/notebooks before saving.
  'dashboard:read',
  'insight:read',
  'notebook:read',

  // Read on every product surface the tutorial demos.
  'feature_flag:read',
  'experiment:read',
  'experiment_saved_metric:read',
  'survey:read',
  'session_recording:read',
  'error_tracking:read',
  'web_analytics:read',
  'llm_analytics:read',
  'cohort:read',
  'person:read',

  // Annotation read + write — the verify prompt's "annotate today"
  // is the only mutation the tutorial performs outside the
  // dashboard/insight/notebook persistence triplet.
  'annotation:read',
  'annotation:write',

  // Metadata / exploration reads — for "break down by user property",
  // "did that change land alongside a deploy", autocapture actions,
  // etc. Otherwise the agent 403s on the supporting catalog calls
  // even though the parent query has `query:read`.
  'activity_log:read',
  'property_definition:read',
  'event_definition:read',
  'action:read',

  // Data warehouse reads — for the data-role cross-sells that join
  // event data with Stripe / Salesforce / S3.
  'warehouse_table:read',
  'warehouse_view:read',

  // Inspection-only — we don't write alerts or subscriptions, but the
  // model might want to read existing ones (e.g. "is there already an
  // alert on this metric?").
  'alert:read',
  'subscription:read',
  'integration:read',
] as const;

/**
 * Extra scopes the agent-skill program needs on top of `WIZARD_OAUTH_SCOPES`.
 *
 * Skills under this program (e.g. `creating-product-tours`) create feature
 * flags during the install flow. PostHog's consent grants exactly the scope
 * strings requested — `:write` does not imply `:read` — so listing existing
 * flags to avoid key collisions needs `feature_flag:read` explicitly.
 * `property_definition:read` lets the agent discover person properties when
 * building flag rollout filters instead of having to ask the user verbatim.
 */
export const AGENT_SKILL_SCOPE_ADDITIONS = [
  'feature_flag:read',
  'feature_flag:write',
  'property_definition:read',
] as const;

/**
 * Extra scope the default wizard run needs on top of `WIZARD_OAUTH_SCOPES`.
 *
 * The Connect-Slack step at the end of the run polls
 * `/api/projects/:id/integrations/` (`fetchSlackConnected`) to render the
 * already-connected variant and to flip live once the user completes the
 * Slack OAuth step in the browser. Without `integration:read` the first
 * poll 403s, the screen stops polling, and an already-connected project
 * is nagged with the connect nudge.
 */
export const POSTHOG_INTEGRATION_SCOPE_ADDITIONS = [
  'integration:read',
] as const;

/**
 * Per-program scope additions, layered on top of `WIZARD_OAUTH_SCOPES`.
 *
 * Programs not listed here request the unchanged base set. Use this
 * map only for programs that need *more* than the base — never for
 * narrowing, since narrowing risks breaking shared infrastructure
 * (e.g. dropping `llm_gateway:read` would 401 every agent call).
 *
 * Keyed by `ProgramId` so TypeScript catches stale entries when a
 * program is renamed or removed.
 */
const PROGRAM_SCOPE_ADDITIONS: Partial<Record<ProgramId, readonly string[]>> = {
  // String literal (not `Program.McpTutorial`) to avoid a runtime cycle
  // with `program-registry.ts`. The `Partial<Record<ProgramId, ...>>`
  // key constraint catches renames at compile time — if `mcpTutorialConfig.id`
  // ever changes, this line will fail to type-check.
  'mcp-tutorial': MCP_TUTORIAL_SCOPE_ADDITIONS,
  'agent-skill': AGENT_SKILL_SCOPE_ADDITIONS,
  'posthog-integration': POSTHOG_INTEGRATION_SCOPE_ADDITIONS,
};

/**
 * Resolve the OAuth scope list to request for a given program. Returns
 * `WIZARD_OAUTH_SCOPES` for programs without an addition entry; for
 * programs that do have one, returns the union of base + additions
 * with duplicates dropped (declaration order preserved, base first).
 *
 * `null` / `undefined` programId falls through to the default — same
 * behavior as the historical hardcoded `WIZARD_OAUTH_SCOPES` reference
 * in `askForWizardLogin`, so call sites that haven't been updated to
 * pass a programId continue to work unchanged.
 */
export function getOAuthScopesForProgram(
  programId: ProgramId | null | undefined,
): readonly string[] {
  const additions = (programId && PROGRAM_SCOPE_ADDITIONS[programId]) || [];
  if (additions.length === 0) {
    return WIZARD_OAUTH_SCOPES;
  }
  // Dedupe while preserving order; base scopes appear first so the
  // consent screen shows them in their familiar slot.
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const s of [...WIZARD_OAUTH_SCOPES, ...additions]) {
    if (seen.has(s)) continue;
    seen.add(s);
    merged.push(s);
  }
  return merged;
}
