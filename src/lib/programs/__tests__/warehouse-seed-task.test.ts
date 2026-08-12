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

vi.mock('@lib/api', () => ({ fetchExternalDataSourceTypes: vi.fn() }));

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

  it('names what was detected', () => {
    expect(notice()?.items).toEqual(['Postgres']);
  });
});

describe('warehouse task verification', () => {
  it('reports which detected in-cli kinds actually landed in the project', async () => {
    const { fetchExternalDataSourceTypes } = await import('@lib/api');
    vi.mocked(fetchExternalDataSourceTypes).mockResolvedValue([
      'Postgres',
      'Hubspot',
    ]);

    const sess = session({
      frameworkContext: {
        [DETECTED_WAREHOUSE_SOURCES_KEY]: [
          POSTGRES,
          {
            kind: 'Stripe',
            label: 'Stripe',
            mode: 'in-cli',
            matchedSignal: 's',
          },
          {
            kind: 'Hubspot',
            label: 'HubSpot',
            mode: 'deep-link',
            matchedSignal: 'h',
          },
        ],
      },
    });
    const entry = seed(sess)[0];
    const props = await entry.verify?.(
      sess,
      {
        accessToken: 't',
        projectApiKey: 'phc',
        projectId: 1,
        host: { apiHost: 'https://us.posthog.com' },
      } as never,
      { status: 'done', inputs: {} },
    );

    expect(props).toMatchObject({
      detected_count: 3,
      detected_in_cli_count: 2,
      sources_connected_count: 1,
      sources_connected_kinds: ['Postgres'],
      sources_missing_kinds: ['Stripe'],
      all_in_cli_connected: false,
      task_status: 'done',
    });
  });
});
