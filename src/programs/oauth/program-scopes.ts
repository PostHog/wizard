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
 * analytics, AI Observability, cohorts, persons) plus read/write on
 * annotations; `AgentSkill` adds feature-flag read/write; the default
 * `PostHogIntegration` run and the standalone `slack` flow add
 * `integration:read` for the Connect-Slack step. Persistence writes (dashboard:write,
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
import type { ProgramId } from '@programs/program-registry';
import {
  WIZARD_OAUTH_SCOPES,
  WIZARD_PROVISIONING_SCOPES,
} from '@shared/constants';
import { AGENT_SKILL_SCOPE_ADDITIONS } from '@programs/agent-skill/scopes';
import { REPLAY_VISION_SCOPE_ADDITIONS } from '@programs/replay-vision/scopes';
import { SELF_DRIVING_SCOPE_ADDITIONS } from '@programs/self-driving/scopes';
import { CONNECT_SLACK_SCOPE_ADDITIONS } from '@shared/oauth-scopes';
import { MCP_TUTORIAL_SCOPE_ADDITIONS } from '@tools/mcp/scopes';

/**
 * Extra scopes the warehouse-source program needs on top of
 * `WIZARD_OAUTH_SCOPES`. The agent creates data warehouse sources directly
 * (`external-data-sources-create`) and lists what's connected
 * (`external-data-sources-list`) to verify the result. Both are already within
 * the wizard OAuth app's scope ceiling — the self-driving program requests the
 * same pair.
 */
export const WAREHOUSE_SOURCE_SCOPE_ADDITIONS = [
  'external_data_source:read',
  'external_data_source:write',
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
  'self-driving': SELF_DRIVING_SCOPE_ADDITIONS,
  'warehouse-source': WAREHOUSE_SOURCE_SCOPE_ADDITIONS,
  // The integration run carries the Slack outro step, and — when detection
  // finds data sources — the orchestrator's warehouse task, which creates
  // sources through `external-data-sources-create`. Without the warehouse pair
  // that call 403s on a token the user already granted.
  'posthog-integration': [
    ...CONNECT_SLACK_SCOPE_ADDITIONS,
    ...WAREHOUSE_SOURCE_SCOPE_ADDITIONS,
  ],
  slack: CONNECT_SLACK_SCOPE_ADDITIONS,
  'replay-vision': REPLAY_VISION_SCOPE_ADDITIONS,
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

/**
 * Resolve the scope list for the signup provisioning path. Same
 * base-plus-additions shape as `getOAuthScopesForProgram`, but layered on
 * `WIZARD_PROVISIONING_SCOPES` so a program's extra scopes only reach
 * tokens provisioned for that program.
 */
export function getProvisioningScopesForProgram(
  programId: ProgramId | null | undefined,
): readonly string[] {
  const additions = (programId && PROGRAM_SCOPE_ADDITIONS[programId]) || [];
  if (additions.length === 0) {
    return WIZARD_PROVISIONING_SCOPES;
  }
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const s of [...WIZARD_PROVISIONING_SCOPES, ...additions]) {
    if (seen.has(s)) continue;
    seen.add(s);
    merged.push(s);
  }
  return merged;
}
