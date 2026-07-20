/**
 * The warehouse setup composed into the default integration flow.
 *
 * The load-bearing invariant is "exactly one non-composed run per invocation":
 * the last run owns the outro and the analytics shutdown, so if the warehouse
 * run is coming, the integration run must be composed — and if it isn't, the
 * integration run must not be. Both directions are covered here.
 */

import { POSTHOG_INTEGRATION_PROGRAM } from '@lib/programs/posthog-integration/steps';
import {
  warehouseRunStep,
  describeConnectedSources,
} from '@lib/programs/posthog-integration/warehouse-step';
import { buildIntegrationOutroData } from '@lib/programs/posthog-integration/outro';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@lib/programs/warehouse-source/detect';
import { hasLaterRun } from '@lib/runners/run-wizard';
import {
  buildSession,
  RunPhase,
  type WizardSession,
} from '@lib/wizard-session';
import type { ProgramStep } from '@lib/programs/program-step';
import type { DetectedSource } from '@lib/warehouse-sources/types';

const POSTGRES: DetectedSource = {
  kind: 'postgres',
  label: 'Postgres',
  mode: 'in-cli',
  matchedSignal: 'DATABASE_URL in .env',
};

const STRIPE: DetectedSource = {
  kind: 'stripe',
  label: 'Stripe',
  mode: 'in-cli',
  matchedSignal: 'stripe in package.json',
};

function session(overrides: Partial<WizardSession> = {}): WizardSession {
  return Object.assign(buildSession({ installDir: '/tmp/app' }), overrides);
}

/** A session with sources detected, as the detect step would leave it. */
function withSources(
  sources: DetectedSource[],
  overrides: Partial<WizardSession> = {},
): WizardSession {
  const s = session(overrides);
  s.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY] = sources;
  return s;
}

const stepById = (id: string): ProgramStep => {
  const step = POSTHOG_INTEGRATION_PROGRAM.find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
};

describe('warehouse-offer step', () => {
  const offer = () => stepById('warehouse-offer');

  it('sits before auth, so the answer is known before any run starts', () => {
    const ids = POSTHOG_INTEGRATION_PROGRAM.map((s) => s.id);
    expect(ids.indexOf('warehouse-offer')).toBeLessThan(ids.indexOf('auth'));
    expect(ids.indexOf('warehouse-offer')).toBeLessThan(ids.indexOf('run'));
  });

  it.each([
    ['no sources detected', [], null, false],
    ['sources detected, undecided', [POSTGRES], null, true],
    ['sources detected, already accepted', [POSTGRES], true, false],
    ['sources detected, already declined', [POSTGRES], false, false],
    ['no sources but somehow decided', [], true, false],
  ])('show — %s', (_label, sources, optIn, expected) => {
    const s = withSources(sources, {
      warehouseOptIn: optIn,
    });
    expect(offer().show?.(s)).toBe(expected);
  });

  it.each([
    [null, false],
    [true, true],
    [false, true],
  ])('isComplete — warehouseOptIn %s', (optIn, expected) => {
    const s = withSources([POSTGRES], {
      warehouseOptIn: optIn,
    });
    expect(offer().isComplete?.(s)).toBe(expected);
  });

  it('has no gate — the composed walk blocks on isComplete instead', () => {
    expect(offer().gate).toBeUndefined();
  });
});

describe('warehouse-run step', () => {
  it.each([
    [null, false],
    [false, false],
    [true, true],
  ])('show — warehouseOptIn %s', (optIn, expected) => {
    const s = withSources([POSTGRES], {
      warehouseOptIn: optIn,
    });
    expect(warehouseRunStep.show?.(s)).toBe(expected);
  });

  it('is placed after the integration run and before the outro', () => {
    const ids = POSTHOG_INTEGRATION_PROGRAM.map((s) => s.id);
    expect(ids.indexOf('warehouse-run')).toBeGreaterThan(ids.indexOf('run'));
    expect(ids.indexOf('warehouse-run')).toBeLessThan(ids.indexOf('outro'));
  });

  it('tracks completion via completedRuns, not the shared runPhase', () => {
    // The integration run leaves runPhase at Completed. A runPhase-based
    // predicate would read as already-done here and flash the outro.
    const afterIntegration = withSources([POSTGRES], {
      warehouseOptIn: true,
      runPhase: RunPhase.Completed,
      completedRuns: ['run'],
    });
    expect(warehouseRunStep.isComplete?.(afterIntegration)).toBe(false);

    const afterWarehouse = withSources([POSTGRES], {
      warehouseOptIn: true,
      completedRuns: ['run', 'warehouse-run'],
    });
    expect(warehouseRunStep.isComplete?.(afterWarehouse)).toBe(true);
  });
});

describe('integration run step completion', () => {
  const run = () => stepById('run');

  it('holds after the warehouse run resets runPhase', () => {
    // completeRunStep sets runPhase back to Idle. Without the completedRuns
    // signal the router would re-show the integration run screen.
    const s = withSources([POSTGRES], {
      warehouseOptIn: true,
      runPhase: RunPhase.Idle,
      completedRuns: ['run'],
    });
    expect(run().isComplete?.(s)).toBe(true);
  });

  it.each([
    [RunPhase.Completed, true],
    [RunPhase.Error, true],
    [RunPhase.Running, false],
    [RunPhase.Idle, false],
  ])('falls back to runPhase %s when uncomposed', (phase, expected) => {
    const s = session({ runPhase: phase, completedRuns: [] });
    expect(run().isComplete?.(s)).toBe(expected);
  });
});

describe('hasLaterRun — exactly one non-composed run', () => {
  const runIndex = POSTHOG_INTEGRATION_PROGRAM.findIndex((s) => s.id === 'run');

  it('composes the integration run when warehouse setup will follow', () => {
    const s = withSources([POSTGRES], { warehouseOptIn: true });
    expect(hasLaterRun(POSTHOG_INTEGRATION_PROGRAM, runIndex, s)).toBe(true);
  });

  it.each([
    ['declined', false],
    ['undecided', null],
  ])('leaves the integration run terminal when %s', (_label, optIn) => {
    const s = withSources([POSTGRES], {
      warehouseOptIn: optIn,
    });
    expect(hasLaterRun(POSTHOG_INTEGRATION_PROGRAM, runIndex, s)).toBe(false);
  });

  it('leaves the warehouse run itself terminal — it is the last run', () => {
    const s = withSources([POSTGRES], { warehouseOptIn: true });
    const whIndex = POSTHOG_INTEGRATION_PROGRAM.findIndex(
      (step) => step.id === 'warehouse-run',
    );
    expect(hasLaterRun(POSTHOG_INTEGRATION_PROGRAM, whIndex, s)).toBe(false);
  });

  it('ignores steps that carry no agent run', () => {
    const steps: ProgramStep[] = [
      { id: 'run', label: 'Run', screenId: 'run' },
      { id: 'mcp', label: 'MCP', screenId: 'mcp' },
    ];
    expect(hasLaterRun(steps, 0, session())).toBe(false);
  });

  it('ignores later run steps that are hidden', () => {
    const steps: ProgramStep[] = [
      { id: 'run', label: 'Run', screenId: 'run' },
      {
        id: 'later',
        label: 'Later',
        screenId: 'run',
        show: () => false,
        run: () => Promise.resolve(),
      },
    ];
    expect(hasLaterRun(steps, 0, session())).toBe(false);
  });

  it('counts a later run step with no show predicate', () => {
    const steps: ProgramStep[] = [
      { id: 'run', label: 'Run', screenId: 'run' },
      {
        id: 'later',
        label: 'Later',
        screenId: 'run',
        run: () => Promise.resolve(),
      },
    ];
    expect(hasLaterRun(steps, 0, session())).toBe(true);
  });
});

describe('describeConnectedSources', () => {
  const MONGO: DetectedSource = {
    kind: 'mongodb',
    label: 'MongoDB',
    mode: 'in-cli',
    matchedSignal: 'mongodb in package.json',
  };

  it.each([
    [[], ''],
    [[POSTGRES], 'Connected Postgres as a data warehouse source'],
    [
      [POSTGRES, STRIPE],
      'Connected Postgres and Stripe as data warehouse sources',
    ],
    [
      [POSTGRES, STRIPE, MONGO],
      'Connected Postgres, Stripe and MongoDB as data warehouse sources',
    ],
  ])('%# sources', (sources, expected) => {
    expect(describeConnectedSources(withSources(sources))).toBe(expected);
  });
});

describe('buildIntegrationOutroData', () => {
  const credentials = {
    accessToken: 'tok',
    projectApiKey: 'phc_test',
    projectId: '1',
    host: {
      apiHost: 'https://us.i.posthog.com',
      appHost: 'https://us.posthog.com',
    },
  };

  const frameworkConfig = {
    metadata: { docsUrl: 'https://posthog.com/docs' },
    environment: { getEnvVars: () => ({ POSTHOG_KEY: 'phc_test' }) },
    ui: { getOutroChanges: () => ['Added PostHog provider'] },
  };

  function outroSession(overrides: Partial<WizardSession> = {}): WizardSession {
    const s = withSources([POSTGRES, STRIPE], overrides);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s.frameworkConfig = frameworkConfig as any;
    return s;
  }

  it('is unchanged when no extra changes are passed (extraction parity)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = buildIntegrationOutroData(outroSession(), credentials as any);

    expect(data.message).toBe('Successfully installed PostHog!');
    expect(data.reportFile).toBe('posthog-setup-report.md');
    expect(data.docsUrl).toBe('https://posthog.com/docs');
    expect(data.changes).toEqual([
      'Added PostHog provider',
      'Added environment variables to .env file',
    ]);
    expect(data.handoffPrompt).toContain('posthog-setup-report.md');
  });

  it('keeps the PostHog headline and appends what the warehouse run connected', () => {
    const data = buildIntegrationOutroData(
      outroSession(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      credentials as any,
      ['Connected Postgres and Stripe as data warehouse sources'],
    );

    // Not "Data warehouse source connected!" — the headline is still the install.
    expect(data.message).toBe('Successfully installed PostHog!');
    expect(data.changes).toContain(
      'Connected Postgres and Stripe as data warehouse sources',
    );
  });

  it('drops empty extra changes rather than rendering a blank bullet', () => {
    const data = buildIntegrationOutroData(
      outroSession(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      credentials as any,
      [''],
    );
    expect(data.changes).not.toContain('');
  });
});
