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
 * Map each `--product=<id>` choice to the context-mill skill ID that handles
 * it. Adding a variant: drop a new row here. The CLI `choices` and the
 * runtime lookup both read from this map, so the two stay in sync.
 */
const PRODUCT_TO_SKILL_ID = {
  statsig: 'migrate-statsig',
  mixpanel: 'migrate-mixpanel',
  amplitude: 'migrate-amplitude',
  sentry: 'migrate-sentry',
} as const;

type MigrateProduct = keyof typeof PRODUCT_TO_SKILL_ID;
const MIGRATE_PRODUCTS = Object.keys(PRODUCT_TO_SKILL_ID) as MigrateProduct[];

export const migrationConfig: ProgramConfig = {
  command: 'migrate',
  description: 'Migrate to PostHog from another analytics provider',
  id: 'migration',
  skillId: PRODUCT_TO_SKILL_ID.statsig,
  steps: MIGRATION_PROGRAM,
  reportFile: MIGRATION_REPORT_FILE,
  getContentBlocks,
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
  cliOptions: {
    product: {
      describe: 'Source SDK to migrate from',
      type: 'string',
      choices: MIGRATE_PRODUCTS,
      demandOption: true,
    },
  },
  mapCliOptions: (argv) => ({
    skillId: PRODUCT_TO_SKILL_ID[argv.product as MigrateProduct],
  }),
  // `run` is a function so the per-invocation skillId set by
  // `mapCliOptions` (`--product=<id>` → `migrate-<id>`) flows through.
  // A static object here would freeze the skillId at module load and
  // every `migrate` invocation would install whichever default we put
  // in the object, regardless of the CLI flag.
  run: (session) =>
    Promise.resolve({
      skillId: session.skillId ?? PRODUCT_TO_SKILL_ID.statsig,
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
