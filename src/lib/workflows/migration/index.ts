import type { WorkflowConfig } from '../workflow-step.js';
import { MIGRATION_WORKFLOW } from './steps.js';

export const migrationConfig: WorkflowConfig = {
  command: 'migrate',
  description: 'Migrate to PostHog from another analytics provider',
  flowKey: 'migration',
  steps: MIGRATION_WORKFLOW,
  run: {
    skillId: 'migrate',
    integrationLabel: 'migration',
    customPrompt: () =>
      'Migrate this project from its existing third-party analytics, feature-flag, and observability tools to PostHog.',
    successMessage: 'Migration complete!',
    reportFile: 'posthog-migration-report.md',
    docsUrl: 'https://posthog.com/docs/migrate',
    spinnerMessage: 'Migrating to PostHog...',
    estimatedDurationMinutes: 8,
  },
  requires: ['posthog-integration'],
};

export { MIGRATION_WORKFLOW } from './steps.js';
