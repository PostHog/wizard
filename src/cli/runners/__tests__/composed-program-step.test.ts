import { advanceStep } from '../run-wizard';
import { runProgramAgent } from '../run-program-agent';
import { posthogIntegrationConfig } from '@programs/posthog-integration/index';
import { selfDrivingConfig } from '@programs/self-driving/index';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '@programs/self-driving/detect';
import { buildSession, RunPhase } from '@lib/wizard-session';
import { WizardStore } from '@tui/store';

vi.mock('../run-program-agent', () => ({
  runProgramAgent: vi.fn().mockResolvedValue(undefined),
}));

it('dispatches the declared integration child with a scoped session and records completion', async () => {
  const step = selfDrivingConfig.steps.find(
    (entry) => entry.id === 'integrate-run',
  );
  expect(step).toBeDefined();
  if (!step) throw new Error('missing integration run step');
  expect(selfDrivingConfig.runSteps?.['integrate-run']?.runProgramId).toBe(
    'posthog-integration',
  );

  const store = new WizardStore('self-driving');
  const session = buildSession({ installDir: '/repo' });
  session.frameworkContext[SELF_DRIVING_INTEGRATE_PATH_KEY] = 'apps/web';
  store.session = session;

  const runStep = selfDrivingConfig.runSteps?.['integrate-run'];
  await advanceStep(step, store, {
    ...selfDrivingConfig,
    runSteps: {
      'integrate-run': { ...runStep, onRunPrep: () => Promise.resolve() },
    },
  });

  expect(runProgramAgent).toHaveBeenCalledWith(
    posthogIntegrationConfig,
    expect.objectContaining({ installDir: '/repo/apps/web' }),
    { composed: true },
  );
  expect(store.session.completedRuns).toContain('integrate-run');
  expect(store.session.runPhase).toBe(RunPhase.Idle);
});
