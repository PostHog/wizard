import type { WorkflowConfig } from '../workflow-step.js';
import type { AbortCase } from '../../agent/agent-runner.js';
import { MIGRATION_WORKFLOW } from './steps.js';
import { getContentBlocks } from './content/index.js';

const MIGRATION_REPORT_FILE = 'migration-report.md';

const MIGRATION_ABORT_CASES: AbortCase[] = [
  {
    match: /^no source-sdk calls found$/i,
    message: 'No source-SDK calls found',
    body:
      'The migration needs an existing third-party SDK to migrate from. No ' +
      'calls to the source SDK appear anywhere in this project. If you ' +
      "haven't installed PostHog yet, you don't need this command — run " +
      '`npx @posthog/wizard@latest` to add PostHog from scratch.',
  },
];

const MIGRATE_PRODUCTS = ['statsig'] as const;

export const migrationConfig: WorkflowConfig = {
  command: 'migrate',
  description: 'Migrate to PostHog from another analytics provider',
  flowKey: 'migration',
  skillId: 'migrate-statsig',
  steps: MIGRATION_WORKFLOW,
  reportFile: MIGRATION_REPORT_FILE,
  getContentBlocks,
  cliOptions: {
    product: {
      describe: 'Source SDK to migrate from',
      type: 'string',
      choices: MIGRATE_PRODUCTS,
      demandOption: true,
    },
  },
  mapCliOptions: (argv) => ({ skillId: `migrate-${argv.product as string}` }),
  run: {
    skillId: 'migrate-statsig',
    integrationLabel: 'migration',
    customPrompt: () =>
      'Migrate this project from its existing third-party analytics, ' +
      'feature-flag, and observability tools to PostHog. Run the `migrate` ' +
      'skill end-to-end: follow the step chain starting at ' +
      'references/1-presence.md. Only replace existing source-SDK call sites ' +
      'with PostHog equivalents — make zero unrelated changes and no ' +
      `net-new instrumentation. The final report is written to ./${MIGRATION_REPORT_FILE}.`,
    successMessage: `Migration complete! View the report at ./${MIGRATION_REPORT_FILE}`,
    reportFile: MIGRATION_REPORT_FILE,
    docsUrl: '',
    spinnerMessage: 'Migrating to PostHog...',
    estimatedDurationMinutes: 8,
    abortCases: MIGRATION_ABORT_CASES,
  },
  requires: ['posthog-integration'],
};

export { MIGRATION_WORKFLOW } from './steps.js';
