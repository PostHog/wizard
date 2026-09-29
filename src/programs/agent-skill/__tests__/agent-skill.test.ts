import {
  createSkillProgram,
  type SkillProgramOptions,
} from '@programs/shared/skill-program';
import type { ProgramRun } from '@programs/program-run';

const baseOpts: SkillProgramOptions = {
  skillId: 'error-tracking-setup',
  command: 'errors',
  id: 'error-tracking',
  description: 'Set up PostHog error tracking',
  integrationLabel: 'error-tracking',
  successMessage: 'Error tracking configured!',
  reportFile: 'posthog-error-tracking-report.md',
  docsUrl: 'https://posthog.com/docs/error-tracking',
  spinnerMessage: 'Setting up error tracking...',
  estimatedDurationMinutes: 5,
};

describe('createSkillProgram', () => {
  it('produces a ProgramConfig with static run (not a function)', () => {
    const config = createSkillProgram(baseOpts);

    expect(config.command).toBe('errors');
    expect(config.id).toBe('error-tracking');

    // run must be a static object — skill programs don't need dynamic resolution
    const run = config.run as ProgramRun;
    expect(typeof config.run).toBe('object');
    expect(run.skillId).toBe('error-tracking-setup');
    expect(run.integrationLabel).toBe('error-tracking');
  });

  it('wraps customPrompt string into a function, omits when absent', () => {
    const withPrompt = createSkillProgram({
      ...baseOpts,
      customPrompt: 'Do the thing.',
    });
    const without = createSkillProgram(baseOpts);

    expect((withPrompt.run as ProgramRun).customPrompt!(null as never)).toBe(
      'Do the thing.',
    );
    expect((without.run as ProgramRun).customPrompt).toBeUndefined();
  });
});
