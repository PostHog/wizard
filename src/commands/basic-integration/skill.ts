import type { Arguments } from 'yargs';
import { POSTHOG_DOCS_URL } from '@lib/constants';
import { runWizard } from '@lib/runners';
import { createSkillProgram } from '@lib/programs/agent-skill/index';

/** Run an arbitrary context-mill skill by id (`--skill <id>`). */
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
  runWizard(config, { ...argv, skillId });
}
