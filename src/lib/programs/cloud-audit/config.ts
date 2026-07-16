/**
 * Where the hosted audit agent lives, and what we ask it to do.
 */
import { IS_DEV } from '@lib/constants';
import type { CloudRegion } from '@utils/types';

/** Slug of the seeded agent application that runs the audit. */
export const CLOUD_AUDIT_SLUG = 'wizard-audit';

/**
 * Escape hatch for pointing the wizard at a local or staging ingress. Takes a
 * fully-resolved base URL (the agent's root, no trailing slash), e.g.
 * `http://localhost:3030/agents/wizard-audit`.
 */
const AGENT_URL_ENV = 'POSTHOG_WIZARD_AGENT_URL';

/**
 * Resolve the agent's base URL.
 *
 * The ingress addresses agents two ways and the mode is a deployment setting
 * (`AGENT_INGRESS_ROUTING_MODE`), not something a client can detect:
 *   - `domain`: `https://<slug><suffix>`, routes at root — how production runs.
 *   - `path`:   `<base>/agents/<slug>`   — how local dev runs, via bin/agent-tunnel.
 *
 * We assume the mode that matches the environment, and let the env var override
 * when that assumption is wrong.
 */
export function resolveAgentBaseUrl(
  region: CloudRegion,
  slug: string = CLOUD_AUDIT_SLUG,
): string {
  const override = process.env[AGENT_URL_ENV]?.trim();
  if (override) return override.replace(/\/$/, '');

  if (IS_DEV) {
    return `http://localhost:3030/agents/${slug}`;
  }

  // Domain mode, matching the suffix documented in posthog's own settings
  // (`AGENT_INGRESS_DOMAIN_SUFFIX`, "e.g. .agents.us.posthog.com").
  return `https://${slug}.agents.${region}.posthog.com`;
}

/**
 * The opening turn.
 *
 * Deliberately thin: the audit's actual instructions live in the agent's own
 * bundle (its agent.md and the `audit-events` skill it loads), server-side.
 * Restating them here would fork the audit's behaviour into a surface that
 * needs a wizard release to change, which is the whole thing this design
 * avoids. This only says which project to look at and how to report.
 */
export function buildAuditTask(ctx: {
  projectId: string | number;
  host: string;
  reportFile: string;
}): string {
  return [
    "Audit this project's PostHog event capture.",
    '',
    'Load your audit-events skill (@posthog/load-skill id "audit-events") and its',
    'reference files, then follow it. Read the codebase through your client tools',
    '(list_files, grep_files, read_file) — do not modify any project file.',
    '',
    'Track the checks with the resolve_checks tool: call it once with an empty',
    'updates list to read the catalog, then resolve each check as you settle it.',
    `When every check is resolved, write the report exactly once to ${ctx.reportFile}`,
    'via write_file.',
    '',
    'Record any skill deficiencies you hit to the skill_feedback table with',
    '@posthog/table-append as you go.',
    '',
    'Project context:',
    `- PostHog Project ID: ${ctx.projectId}`,
    `- PostHog Host: ${ctx.host}`,
    '',
    'Begin.',
  ].join('\n');
}
