import {
  createSkillWorkflow,
  AGENT_SKILL_STEPS,
  type SkillWorkflowOptions,
} from '../agent-skill/index.js';
import type { WorkflowRun } from '../../agent/agent-runner.js';
import { buildSession, RunPhase } from '../../wizard-session.js';

const baseOpts: SkillWorkflowOptions = {
  skillId: 'error-tracking-setup',
  command: 'errors',
  flowKey: 'error-tracking',
  description: 'Set up PostHog error tracking',
  integrationLabel: 'error-tracking',
  successMessage: 'Error tracking configured!',
  reportFile: 'posthog-error-tracking-report.md',
  docsUrl: 'https://posthog.com/docs/error-tracking',
  spinnerMessage: 'Setting up error tracking...',
  estimatedDurationMinutes: 5,
};

describe('createSkillWorkflow', () => {
  it('produces a WorkflowConfig with static run (not a function)', () => {
    const config = createSkillWorkflow(baseOpts);

    expect(config.command).toBe('errors');
    expect(config.flowKey).toBe('error-tracking');
    expect(config.steps).toBe(AGENT_SKILL_STEPS);

    // run must be a static object — skill workflows don't need dynamic resolution
    const run = config.run as WorkflowRun;
    expect(typeof config.run).toBe('object');
    expect(run.skillId).toBe('error-tracking-setup');
    expect(run.integrationLabel).toBe('error-tracking');
  });

  it('wraps customPrompt string into a function, omits when absent', () => {
    const withPrompt = createSkillWorkflow({
      ...baseOpts,
      customPrompt: 'Do the thing.',
    });
    const without = createSkillWorkflow(baseOpts);

    expect((withPrompt.run as WorkflowRun).customPrompt!(null as never)).toBe(
      'Do the thing.',
    );
    expect((without.run as WorkflowRun).customPrompt).toBeUndefined();
  });
});

describe('AGENT_SKILL_STEPS', () => {
  it('is auth → run → outro, all with screens and working predicates', () => {
    expect(AGENT_SKILL_STEPS.map((s) => s.id)).toEqual([
      'auth',
      'run',
      'outro',
    ]);

    const session = buildSession({});
    const [auth, run, outro] = AGENT_SKILL_STEPS;

    // All incomplete initially
    expect(auth.isComplete!(session)).toBe(false);
    expect(run.isComplete!(session)).toBe(false);
    expect(outro.isComplete!(session)).toBe(false);

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
