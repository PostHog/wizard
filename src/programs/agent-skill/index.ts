import type { ProgramConfig } from '../program-step.js';
import { POSTHOG_DOCS_URL } from '@shared/constants.js';
import { AGENT_SKILL_SCOPE_ADDITIONS } from './scopes.js';

// Generic skill program — runs an arbitrary context-mill skill chosen at
// dispatch time (session.skillId) rather than a registered named program.
// Backs `wizard skill <name>` and the narrow `audit` leaves (events,
// feature-flags, identify, session-replay, autocapture); each injects its
// skillId onto the config, which lands on session.skillId before the run.
//
// The `run` recipe is a function rather than a static block because the
// skillId isn't known until dispatch. Without a `run` recipe runProgram fails
// with "has no run configuration" and the skill never executes — so we derive
// generic run metadata from the resolved skill id at run time.
export const config: ProgramConfig = {
  id: 'agent-skill',
  description: 'Run an arbitrary context-mill skill',
  allowedTools: ['Agent'],
  oauthScopeAdditions: AGENT_SKILL_SCOPE_ADDITIONS,
  run: (session) => {
    const skillId = session.skillId ?? 'agent-skill';
    return Promise.resolve({
      skillId,
      integrationLabel: skillId,
      spinnerMessage: `Running ${skillId}...`,
      successMessage: `${skillId} complete!`,
      estimatedDurationMinutes: 5,
      reportFile: `posthog-${skillId}-report.md`,
      docsUrl: POSTHOG_DOCS_URL,
    });
  },
};
