import type { ProgramConfig } from '@programs/program-step';
import { WIZARD_TOOL_NAMES } from '@agent';
import { MIGRATION_PROGRAM } from './steps.js';
import { getContentBlocks } from '../../ui/tui/decks/migration/index.js';
import {
  DEFAULT_MIGRATE_SKILL_ID,
  MIGRATION_REPORT_FILE,
  MIGRATION_RUN,
} from './run.js';

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
  run: MIGRATION_RUN,
  requires: ['posthog-integration'],
};

export { MIGRATION_PROGRAM } from './steps.js';
