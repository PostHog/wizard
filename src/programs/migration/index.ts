import type { ProgramConfig } from '@programs/program-step';
import {
  MIGRATION_REPORT_FILE,
  DEFAULT_MIGRATE_SKILL_ID,
  MIGRATION_RUN,
} from './run.js';
import { WIZARD_TOOL_NAMES } from '@agent';
import { MIGRATION_PROGRAM } from './steps.js';

export const migrationConfig: ProgramConfig = {
  command: 'migrate',
  description: 'Migrate to PostHog from another analytics provider',
  id: 'migration',
  skillId: DEFAULT_MIGRATE_SKILL_ID,
  steps: MIGRATION_PROGRAM,
  reportFile: MIGRATION_REPORT_FILE,
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
  run: MIGRATION_RUN,
  requires: ['posthog-integration'],
};

export { MIGRATION_PROGRAM } from './steps.js';
