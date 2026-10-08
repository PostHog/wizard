import type { ProgramConfig } from '../program-step';
import type { ProgramRun } from '../program-run';
import type { ProgramSession } from '../program-session';
import { LONGER_ASK_TIMEOUT_MS } from '@shared/ask-policy';
import { WAREHOUSE_SOURCE_SCOPE_ADDITIONS } from '../oauth/program-scopes';
import {
  detectWarehousePrerequisites,
  WAREHOUSE_ABORT_CASES,
} from './detect.js';
import { getDetectedWarehouseSources } from '../warehouse-sources/detect';

/**
 * Inject the detected sources (and their creation mode) into the prompt so the
 * skill knows what to set up. The *how* — in-CLI creation vs deep-link, field
 * collection, validation — lives in the skill, not here.
 */
function buildPrompt(session: ProgramSession): string {
  const sources = getDetectedWarehouseSources(session);
  if (sources.length === 0) {
    return 'Set up a data warehouse source for this project.';
  }

  const lines = sources.map(
    (s) =>
      `- ${s.label} (kind: ${s.kind}, mode: ${s.mode}) — ${s.matchedSignal}`,
  );

  return [
    'The wizard detected the following data warehouse sources in this project:',
    ...lines,
    '',
    'Each signal names the file it came from. Trust that path — the wizard ' +
      'read it. To confirm a key is set, call `check_env_keys` with the key ' +
      'names and no `filePath`; it scans every `.env` file in the project.',
    '',
    'Set these up in PostHog following the skill instructions: create `in-cli` ' +
      'sources directly via the PostHog MCP after collecting credentials; for ' +
      '`deep-link` sources, provide the user the pre-filled new-source URL.',
    'Use the `kind` string exactly as printed above for `source_type` — ' +
      'PostHog rejects the display label.',
  ].join('\n');
}

export const config: ProgramConfig = {
  command: 'warehouse',
  description: 'Detect and connect Data Warehouse sources',
  id: 'warehouse-source',
  skillId: 'data-warehouse-source-setup',
  onReady: (ctx) =>
    detectWarehousePrerequisites(ctx.session, ctx.setFrameworkContext),
  oauthScopeAdditions: WAREHOUSE_SOURCE_SCOPE_ADDITIONS,
  // No health-check screen in the TUI flow; the run skips the readiness check.
  healthCheck: false,
  reportFile: 'posthog-warehouse-report.md',
  allowedTools: ['Agent'],
  run: (session: ProgramSession): Promise<ProgramRun> =>
    Promise.resolve({
      skillId: 'data-warehouse-source-setup',
      integrationLabel: 'data-warehouse-source-setup',
      customPrompt: () => buildPrompt(session),
      successMessage: 'Data warehouse source connected!',
      reportFile: 'posthog-warehouse-report.md',
      docsUrl: 'https://posthog.com/docs/data-warehouse',
      spinnerMessage: 'Connecting your data source...',
      estimatedDurationMinutes: 5,
      // Same questions the orchestrator's seeded warehouse task asks, so the
      // same allowance. On the 5-minute default a user who went to fetch a
      // database password came back to a cancelled prompt and the browser
      // fallback — in the command the outro sends declines to.
      askTimeoutMs: LONGER_ASK_TIMEOUT_MS,
      abortCases: WAREHOUSE_ABORT_CASES,
    }),
  requires: ['posthog-integration'],
};

export {
  detectWarehousePrerequisites,
  WAREHOUSE_ABORT_CASES,
  type WarehouseDetectError,
} from './detect.js';
export {
  getDetectedWarehouseSources,
  DETECTED_WAREHOUSE_SOURCES_KEY,
} from '../warehouse-sources/detect';
