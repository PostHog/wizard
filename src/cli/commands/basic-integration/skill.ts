import type { Arguments } from 'yargs';
import { POSTHOG_DOCS_URL } from '@store';
import { dispatchProgram } from '../factories/shared.js';
import { createSkillProgram } from '@store/programs';

/** Run an arbitrary context-mill skill by id (`wizard skill <id>`, headless with `--ci`). */
export function runSkillMode(argv: Arguments): void {
  const skillId = argv.skill as string;
  const config = createSkillProgram({
    skillId,
    command: 'skill',
    id: 'agent-skill',
    description: `Run skill: ${skillId}`,
    integrationLabel: skillId,
    successMessage: `${skillId} completed!`,
    reportFile: `posthog-${skillId}-report.md`,
    docsUrl: POSTHOG_DOCS_URL,
    spinnerMessage: `Running ${skillId}...`,
    estimatedDurationMinutes: 5,
  });
  dispatchProgram(config, { ...argv, skillId });
}
