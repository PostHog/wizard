import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';
import type { DetectedSource } from '@lib/warehouse-sources/types';
import { WAREHOUSE_SOURCE_PROGRAM } from './steps.js';
import { WAREHOUSE_ABORT_CASES } from './detect.js';
import { getContentBlocks } from './content/index.js';

function getDetectedSources(session: WizardSession): DetectedSource[] {
  return (
    (session.frameworkContext.detectedWarehouseSources as
      | DetectedSource[]
      | undefined) ?? []
  );
}

/**
 * Inject the detected sources (and their creation mode) into the prompt so the
 * skill knows what to set up. The *how* — in-CLI creation vs deep-link, field
 * collection, validation — lives in the skill, not here.
 */
function buildPrompt(session: WizardSession): string {
  const sources = getDetectedSources(session);
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
    'Set these up in PostHog following the skill instructions: create `in-cli` ' +
      'sources directly via the PostHog MCP after collecting credentials; for ' +
      '`deep-link` sources, provide the user the pre-filled new-source URL.',
  ].join('\n');
}

export const warehouseSourceConfig: ProgramConfig = {
  command: 'warehouse',
  description:
    'Detect and connect a data warehouse source (Postgres, Stripe, …)',
  id: 'warehouse-source',
  skillId: 'data-warehouse-source-setup',
  steps: WAREHOUSE_SOURCE_PROGRAM,
  getContentBlocks,
  reportFile: 'posthog-warehouse-report.md',
  allowedTools: ['Agent'],
  run: (session: WizardSession): Promise<ProgramRun> =>
    Promise.resolve({
      skillId: 'data-warehouse-source-setup',
      integrationLabel: 'data-warehouse-source-setup',
      customPrompt: () => buildPrompt(session),
      successMessage: 'Data warehouse source connected!',
      reportFile: 'posthog-warehouse-report.md',
      docsUrl: 'https://posthog.com/docs/data-warehouse',
      spinnerMessage: 'Connecting your data source...',
      estimatedDurationMinutes: 5,
      abortCases: WAREHOUSE_ABORT_CASES,
    }),
  requires: ['posthog-integration'],
};

export { WAREHOUSE_SOURCE_PROGRAM } from './steps.js';
export {
  detectWarehousePrerequisites,
  WAREHOUSE_ABORT_CASES,
  type WarehouseDetectError,
} from './detect.js';
