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
 * Today only `McpTutorial` adds anything: read-only on every product
 * surface (feature flags, experiments, surveys, replays, errors, web
 * analytics, LLM analytics, cohorts, persons) plus read/write on
 * annotations. Persistence writes (dashboard:write, insight:write,
 * notebook:write, query:read) come for free from the base set, so the
 * tutorial's "save as insight / pin to dashboard / add to notebook"
 * follow-ups keep working.
 *
 * Add a new program override by extending `PROGRAM_SCOPE_ADDITIONS`
 * below — no other call-site changes required as long as the program's
 * `programId` is threaded into `getOrAskForProjectData`.
 */

import { Program, type ProgramId } from '@lib/programs/program-registry';
import { WIZARD_OAUTH_SCOPES } from '@lib/constants';

/**
 * Extra scopes the MCP tutorial needs on top of `WIZARD_OAUTH_SCOPES`.
 *
 * Mirrors the wizard partner's full OAuth ceiling on the PostHog side
 * (see the comma-delimited list in the wizard OAuth app's
 * `OAuthApplication.scopes`). The tutorial's prompts and follow-ups
 * touch most of the read surface, plus annotation write for the
 * "PostHog wizard install" verify-prompt.
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
  [Program.McpTutorial]: MCP_TUTORIAL_SCOPE_ADDITIONS,
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
