/**
 * Generic agent skill program factory.
 *
 * Creates a ProgramConfig for any context-mill skill. Provide a
 * skill ID and basic UI config — the factory handles the rest.
 *
 * Usage:
 *   createSkillProgram({
 *     skillId: 'error-tracking-setup',
 *     command: 'errors',
 *     id: 'error-tracking',
 *     description: 'Set up PostHog error tracking',
 *     integrationLabel: 'error-tracking',
 *     successMessage: 'Error tracking configured!',
 *     reportFile: 'posthog-error-tracking-report.md',
 *     docsUrl: 'https://posthog.com/docs/error-tracking',
 *     spinnerMessage: 'Setting up error tracking...',
 *     estimatedDurationMinutes: 5,
 *   })
 */

import type { ProgramConfig } from '@programs/program-step';
import { AGENT_SKILL_STEPS } from './steps.js';
import {
  skillRunDefinition,
  type SkillProgramOptions,
} from './run-definition.js';

export type { SkillProgramOptions } from './run-definition.js';

export function createSkillProgram(opts: SkillProgramOptions): ProgramConfig {
  return {
    command: opts.command,
    description: opts.description,
    id: opts.id,
    skillId: opts.skillId,
    steps: AGENT_SKILL_STEPS,
    reportFile: opts.reportFile,
    run: skillRunDefinition(opts),
    requires: opts.requires,
  };
}

export { AGENT_SKILL_STEPS } from './steps.js';
