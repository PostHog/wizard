/**
 * Which runs carry the warehouse task. It waits on a person for credentials,
 * so it belongs only in a run that has both something to connect and someone
 * to answer — and the wizard, not the planner, is what decides that.
 */
import type { WizardSession } from '@lib/wizard-session';
import type { DetectedSource } from '@lib/warehouse-sources/types';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));

import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@lib/programs/warehouse-source/detect';

const POSTGRES: DetectedSource = {
  kind: 'Postgres',
  label: 'Postgres',
  mode: 'in-cli',
  matchedSignal: 'pg in package.json',
};

function session(over: Partial<WizardSession> = {}): WizardSession {
  return {
    installDir: '/tmp/app',
    frameworkContext: {},
    ...over,
  } as WizardSession;
}

function seed(sess: WizardSession) {
  return posthogIntegrationConfig.seedTasks?.(sess) ?? [];
}

describe('warehouse seed task', () => {
  it('queues one task carrying every detected source', () => {
    const tasks = seed(
      session({
        frameworkContext: { [DETECTED_WAREHOUSE_SOURCES_KEY]: [POSTGRES] },
      }),
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe('warehouse');
    expect(tasks[0].inputs?.sources).toEqual([
      {
        kind: 'Postgres',
        label: 'Postgres',
        mode: 'in-cli',
        matchedSignal: 'pg in package.json',
      },
    ]);
  });

  it('queues nothing when detection found no source', () => {
    expect(seed(session())).toEqual([]);
  });

  it('queues nothing in CI, where nobody can answer', () => {
    const tasks = seed(
      session({
        ci: true,
        frameworkContext: { [DETECTED_WAREHOUSE_SOURCES_KEY]: [POSTGRES] },
      }),
    );
    expect(tasks).toEqual([]);
  });

  it('queues nothing during signup, where asking is disabled', () => {
    const tasks = seed(
      session({
        signup: true,
        frameworkContext: { [DETECTED_WAREHOUSE_SOURCES_KEY]: [POSTGRES] },
      }),
    );
    expect(tasks).toEqual([]);
  });
});

describe('warehouse task notice', () => {
  const notice = () =>
    seed(
      session({
        frameworkContext: { [DETECTED_WAREHOUSE_SOURCES_KEY]: [POSTGRES] },
      }),
    )[0].notice;

  it('tells the user the run will stop to ask, and offers to skip', () => {
    const n = notice();
    expect(n?.body[0]).toContain(
      'We detected some warehouse sources we can connect to enrich your PostHog data',
    );
    expect(n?.body[1]).toContain('[Skip]');
    expect(n?.docsUrl).toBe('https://posthog.com/docs/data-warehouse/sources');
    expect(n?.cancelLabel).toContain('Skip');
  });

  it('promises the questions come at the end, not mid-run', () => {
    // The task is deferred behind the code work (seeded-deps.ts), so consenting
    // up front must not read as "expect a prompt any moment now".
    expect(notice()?.body[0]).toContain('at the end');
  });

  it('asks for the answer now, and says the credentials come later', () => {
    // Two moments, minutes apart. The copy is shown at the first and has to
    // name the second, or a user who says yes has no idea they will be needed
    // again — which is how an accepted step still ends in an unanswered prompt.
    const body = notice()?.body[0] ?? '';
    expect(body).toContain('Answer now');
    expect(body).toContain('credentials');
  });

  it('does not invite the user to leave for the whole run', () => {
    // The copy written for the old start-of-run modal said "you can leave the
    // setup to run until it asks". The run does stop and ask, at the end, for
    // credentials only that person has.
    expect(notice()?.body.join(' ')).not.toContain('leave the setup to run');
  });

  it('names what was detected', () => {
    expect(notice()?.items).toEqual(['Postgres']);
  });
});
