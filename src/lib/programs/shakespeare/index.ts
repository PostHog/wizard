import { createSkillProgram } from '@lib/programs/agent-skill/index';
import type { ProgramConfig } from '@lib/programs/program-step';
import { getContentBlocks } from './content/index.js';

const SHAKESPEARE_REPORT_FILE = 'posthog-shakespeare-report.md';

const baseConfig = createSkillProgram({
  skillId: 'shakespeare',
  command: 'shakespeare',
  id: 'shakespeare',
  description:
    'Add a line of Shakespeare to your codebase (internal test only)',
  integrationLabel: 'shakespeare',
  successMessage: `Shakespeare quote added! View the report at ./${SHAKESPEARE_REPORT_FILE}`,
  reportFile: SHAKESPEARE_REPORT_FILE,
  docsUrl: 'https://github.com/PostHog/context-mill',
  spinnerMessage: 'Consulting the Bard...',
  estimatedDurationMinutes: 1,
});

/**
 * `wizard shakespeare` — internal test-only program. Installs the
 * context-mill `shakespeare` skill (single variant, no framework matching)
 * and lets the agent run it end to end. Exists purely to exercise the
 * skill-authoring → wizard-program pipeline in isolation; not a real
 * PostHog product flow.
 *
 * Overrides `getContentBlocks` with its own Learn deck (portrait → what
 * this program does → a few lines it might pick) instead of the generic
 * three-line agent-skill deck `createSkillProgram` wires up by default.
 */
export const shakespeareConfig: ProgramConfig = {
  ...baseConfig,
  getContentBlocks,
};
