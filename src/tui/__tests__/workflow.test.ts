/** The TUI answers runProgram's run steps with its flow: a run waits on the screens before it. */
import type { ApiUser } from '@shared/api';
import { HostResolution } from '@shared/host-resolution';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { RunOutcome } from '@programs';
import { SOURCE_MAPS_CONTEXT_KEYS } from '@programs/error-tracking-upload-source-maps';
import { WizardStore } from '../store';
import { tuiWorkflow } from '../workflow';

const approvedUser = {
  organization: { is_ai_data_processing_approved: true },
} as ApiUser;

/** The host settles the intro and the health check before it calls runProgram. */
function loggedIn(store: WizardStore): void {
  store.completeSetup();
  store.setReadinessResult({
    decision: WizardReadiness.Yes,
    health: {} as never,
    reasons: [],
  });
  store.sessions.setLogin({
    posthog: {
      accessToken: 'pha_test',
      projectApiKey: 'phc_test',
      projectId: 1,
      host: HostResolution.fromRegion('us'),
    },
    project: null,
    apiUser: approvedUser,
  });
}

const settles = async (work: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void work.then(() => {
    done = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return done;
};

describe('tuiWorkflow', () => {
  it('holds the source-maps run until the project picker after login settles', async () => {
    const store = new WizardStore('error-tracking-upload-source-maps');
    loggedIn(store);
    const run = tuiWorkflow(
      store,
      'error-tracking-upload-source-maps',
    ).confirmStep(
      {
        kind: 'run',
        stepId: 'run',
        programId: 'error-tracking-upload-source-maps',
      },
      { signal: new AbortController().signal },
    );
    expect(await settles(run)).toBe(false);
    store.setFrameworkContext(
      SOURCE_MAPS_CONTEXT_KEYS.selectedVariant,
      'nextjs',
    );
    await expect(run).resolves.toBe(true);
  });

  it('skips a composed run whose step is hidden, and completes one that ran', async () => {
    const store = new WizardStore('self-driving');
    loggedIn(store);
    const workflow = tuiWorkflow(store, 'self-driving');
    const step = {
      kind: 'run' as const,
      stepId: 'integrate-run',
      programId: 'posthog-integration',
    };
    // The user chose not to integrate first.
    store.setIntegrate(false);
    await expect(
      workflow.confirmStep(step, { signal: new AbortController().signal }),
    ).resolves.toBe(false);

    // A failed composed run keeps its tasks for the outro and the stream.
    workflow.finishStep?.(step, { outcome: RunOutcome.Failed } as never);
    expect(store.completedRuns).toEqual([]);
    workflow.finishStep?.(step, { outcome: RunOutcome.Success } as never);
    expect(store.completedRuns).toEqual(['integrate-run']);
    // The program's own run step follows its phase instead.
    workflow.finishStep?.(
      { ...step, stepId: 'run', programId: 'self-driving' },
      { outcome: RunOutcome.Success } as never,
    );
    expect(store.completedRuns).toEqual(['integrate-run']);
  });

  it('stops the run at a blocking outage, which the health-check screen shows', async () => {
    const store = new WizardStore('metrics');
    const readiness = {
      decision: WizardReadiness.No,
      health: {} as never,
      reasons: ['PostHog is down'],
    };
    await expect(
      tuiWorkflow(store, 'metrics').confirmStep(
        {
          kind: 'service-outage',
          programId: 'metrics',
          installDir: '/project',
          readiness,
        },
        { signal: new AbortController().signal },
      ),
    ).resolves.toBe(false);
    expect(store.session.readinessResult).toBe(readiness);
  });
});
