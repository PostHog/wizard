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

function sources(n: number): DetectedSource[] {
  return Array.from({ length: n }, (_, i) => ({
    ...POSTGRES,
    kind: `Source${i}`,
    label: `Source ${i}`,
  }));
}

function seedSources(n: number) {
  return seed(
    session({
      frameworkContext: { [DETECTED_WAREHOUSE_SOURCES_KEY]: sources(n) },
    }),
  );
}

describe('warehouse seed task', () => {
  it('queues one task carrying the detected source', () => {
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

  it('queues the task in an e2e run, where the harness answers', () => {
    // The e2e host runs a `ci` session but drives the ask overlay itself, so
    // the seeded-task path gets pre-merge coverage instead of none.
    const tasks = seed(
      session({
        ci: true,
        e2eAsk: true,
        frameworkContext: { [DETECTED_WAREHOUSE_SOURCES_KEY]: [POSTGRES] },
      }),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe('warehouse');
  });
});

describe('warehouse task notice', () => {
  const notice = () =>
    seed(
      session({
        frameworkContext: { [DETECTED_WAREHOUSE_SOURCES_KEY]: [POSTGRES] },
      }),
    )[0].notice;

  it('links the warehouse sources docs', () => {
    expect(notice()?.docsUrl).toBe(
      'https://posthog.com/docs/data-warehouse/sources',
    );
  });

  it('names what was detected', () => {
    expect(notice()?.items).toEqual(['Postgres']);
  });
});

describe('warehouse seed task size', () => {
  it('hands the step only the first few sources', () => {
    // One credential prompt per source, so an unbounded list is an unbounded
    // ask. The tail reaches the user as outro links instead.
    const inputs = seedSources(9)[0].inputs?.sources as DetectedSource[];

    expect(inputs).toHaveLength(3);
    expect(inputs.map((s) => s.kind)).toEqual([
      'Source0',
      'Source1',
      'Source2',
    ]);
  });

  it('names only the sources the step will ask about', () => {
    const notice = seedSources(9)[0].notice;

    expect(notice?.items).toEqual(['Source 0', 'Source 1', 'Source 2']);
  });

  it('says where the sources it did not take are going', () => {
    expect(seedSources(9)[0].notice?.body.join(' ')).toContain('6 more');
  });

  it('says nothing about a remainder when there is none', () => {
    expect(seedSources(3)[0].notice?.body.join(' ')).not.toContain(
      'more we can connect',
    );
  });
});
