import type { ProgramConfig } from '@lib/programs/program-step';
import type { AbortCase } from '@lib/agent/agent-runner';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import { MIGRATION_PROGRAM } from './steps.js';
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

// Default skill id when nothing else picks one. The `wizard migrate <vendor>`
// subcommands override this via skillCommandFactory using each manifest
// entry's skillId, so this default only kicks in for legacy callers (e.g.
// programmatic uses of migrationConfig directly).
const DEFAULT_MIGRATE_SKILL_ID = 'migrate-statsig';

export const migrationConfig: ProgramConfig = {
  command: 'migrate',
  description: 'Migrate to PostHog from another analytics provider',
  id: 'migration',
  skillId: DEFAULT_MIGRATE_SKILL_ID,
  steps: MIGRATION_PROGRAM,
  reportFile: MIGRATION_REPORT_FILE,
  getContentBlocks,
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
  run: {
    skillId: DEFAULT_MIGRATE_SKILL_ID,
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

export { MIGRATION_PROGRAM } from './steps.js';
