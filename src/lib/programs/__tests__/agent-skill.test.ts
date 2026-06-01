import {
  createSkillProgram,
  AGENT_SKILL_STEPS,
  type SkillProgramOptions,
} from '@lib/programs/agent-skill/index';
import type { ProgramRun } from '@lib/agent/agent-runner';
import { buildSession, RunPhase } from '@lib/wizard-session';

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
    expect(config.steps).toBe(AGENT_SKILL_STEPS);

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

describe('AGENT_SKILL_STEPS', () => {
  it('is intro → health-check → auth → run → outro → skills, all with screens and working predicates', () => {
    expect(AGENT_SKILL_STEPS.map((s) => s.id)).toEqual([
      'intro',
      'health-check',
      'auth',
      'run',
      'outro',
      'skills',
    ]);

    const session = buildSession({});
    const [intro, , auth, run, outro] = AGENT_SKILL_STEPS;

    // Intro gate starts closed
    expect(intro.gate!(session)).toBe(false);

    // All incomplete initially
    expect(auth.isComplete!(session)).toBe(false);
    expect(run.isComplete!(session)).toBe(false);
    expect(outro.isComplete!(session)).toBe(false);

    // Intro gate opens after setup confirmed
    session.setupConfirmed = true;
    expect(intro.gate!(session)).toBe(true);

    // Completing each
    session.credentials = {
      accessToken: 't',
      projectApiKey: 'k',
      host: 'h',
      projectId: 1,
    };
    expect(auth.isComplete!(session)).toBe(true);

    session.runPhase = RunPhase.Completed;
    expect(run.isComplete!(session)).toBe(true);

    session.outroDismissed = true;
    expect(outro.isComplete!(session)).toBe(true);
  });
});
