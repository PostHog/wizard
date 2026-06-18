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

/**
 * Vendors supported by `wizard migrate <vendor>`. Each entry maps to the
 * context-mill skill that drives that vendor's migration. New vendors get
 * added here and surfaced as family subcommands via the family dispatcher
 * (see `dispatch-family.ts`).
 */
export const MIGRATE_VENDOR_TO_SKILL_ID = {
  statsig: 'migrate-statsig',
  mixpanel: 'migrate-mixpanel',
  amplitude: 'migrate-amplitude',
  sentry: 'migrate-sentry',
} as const;

export type MigrateVendor = keyof typeof MIGRATE_VENDOR_TO_SKILL_ID;

// Default skill id when nothing else picks one. The `wizard migrate <vendor>`
// subcommands override this via the family dispatcher (each CliEntry's
// skillId lands on session.skillId before the run), so this default only
// kicks in for legacy callers (e.g. programmatic uses of migrationConfig
// directly with no skillId).
const DEFAULT_MIGRATE_SKILL_ID = MIGRATE_VENDOR_TO_SKILL_ID.statsig;

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
  // `run` is a function so the per-invocation skillId (set by the family
  // dispatcher when resolving `wizard migrate <vendor>`) flows through to
  // the runner. A static object would freeze the skillId at module load
  // and every vendor would install the default, regardless of the chosen
  // subcommand.
  run: (session) =>
    Promise.resolve({
      skillId: session.skillId ?? DEFAULT_MIGRATE_SKILL_ID,
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
    }),
  requires: ['posthog-integration'],
};

export { MIGRATION_PROGRAM } from './steps.js';
