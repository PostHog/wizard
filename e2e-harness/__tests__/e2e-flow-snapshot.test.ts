/**
 * E2E flow snapshot — the structured-state analog of Sarah's TUI ANSI
 * screenshots (`scripts/cli-screenshots.mjs`, `__screenshots__/*.ans`).
 *
 * Her harness snapshots what a screen *renders*; this snapshots the
 * deterministic control-plane *trace* a `wizard-ci --e2e` run walks: the
 * ordered (screen → committed decision) path the program's `e2e` profile
 * produces. It runs fully offline — the agent and auth are stubbed by injecting
 * the external transitions the runner/agent would make — so it's deterministic
 * and CI-safe, and it fails when the flow shape regresses (a screen appears or
 * disappears, the order changes, or a profile decision changes).
 *
 * Update goldens with `jest -u` after an intentional flow change.
 */

import { RunPhase } from '@shared/run-state';
import { Integration } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';
import { WizardReadiness } from '@shared/health-checks/readiness';
import {
  buildSession,
  FRAMEWORK_REGISTRY,
  Program,
  getProgramConfig,
  type ProgramId,
} from '@programs';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '@programs/self-driving';
import {
  AuditScreenId,
  createTuiStore,
  ScreenId,
  SelfDrivingScreenId,
  SourceMapsScreenId,
  tuiProgramFlow,
  type FlowStep,
  type WizardStore,
} from '@tui';
import { WizardCiDriver } from '../wizard-ci-driver';
import { decideE2eAction, type WizardE2eProfile } from '../e2e-profile';
import { profileFor } from '../profiles';

/** The TUI flows of the programs whose flow runs another program's agent. */
const COMPOSING_FLOWS: Partial<Record<ProgramId, readonly FlowStep[]>> = {
  'self-driving': await tuiProgramFlow(Program.SelfDriving),
};

/**
 * Which run the run screen shows: a composed run step, which completes on its
 * own, or the program's own run, which follows the run phase.
 */
function composedRunStep(
  program: ProgramId,
  store: WizardStore,
): string | undefined {
  const composed = Object.entries(getProgramConfig(program).runSteps ?? {})
    .filter(([, step]) => step.runProgramId)
    .map(([id]) => id);
  if (composed.length === 0) return undefined;
  const flow = COMPOSING_FLOWS[program];
  if (!flow) throw new Error(`No TUI flow for ${program}'s composed runs`);
  const runStep = flow.find(
    (s) =>
      s.screenId === ScreenId.Run &&
      (!s.show || s.show(store)) &&
      (!s.isComplete || !s.isComplete(store)),
  );
  return runStep && composed.includes(runStep.id) ? runStep.id : undefined;
}

/**
 * Walk a program flow offline using an e2e profile, injecting the external
 * transitions a real run gets from the runner (auth), the agent (runPhase), and
 * the health probe. Returns the ordered (screen, action) trace. Stops at the
 * terminal Exit screen or when a profile decision marks the run done.
 */
async function traceFlow(
  program: ProgramId,
  profile: WizardE2eProfile,
  integration?: Integration,
): Promise<
  Array<{
    screen: string;
    action: string;
    params?: Record<string, unknown>;
  }>
> {
  const store = await createTuiStore(program);
  const session = buildSession({ installDir: '/tmp/e2e-snap', ci: true });
  if (integration) {
    session.integration = integration;
    session.frameworkConfig = FRAMEWORK_REGISTRY[integration];
  }
  store.session = session;

  const driver = new WizardCiDriver(store);

  const trace: Array<{
    screen: string;
    action: string;
    params?: Record<string, unknown>;
  }> = [];
  for (let guard = 0; guard < 40; guard++) {
    const state = driver.readState();
    const screen = state.currentScreen;
    if (screen === ScreenId.Exit) break; // terminal (self-driving outro exits)

    const decision = decideE2eAction(state, profile);
    trace.push({
      screen,
      action: decision.action?.id ?? '(external)',
      ...(decision.action?.params ? { params: decision.action.params } : {}),
    });

    if (decision.action) {
      driver.performAction(decision.action.id, decision.action.params ?? {});
    }

    // Inject the transitions a real run gets from outside the driver.
    if (screen === ScreenId.HealthCheck) {
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
    } else if (screen === ScreenId.Auth) {
      store.setCredentials({
        accessToken: 'phx_x',
        projectApiKey: 'phc_x',
        host: HostResolution.fromApiHost('https://us.posthog.com'),
        projectId: 1,
      });
    } else if (screen === SelfDrivingScreenId.Github) {
      // The GitHub gate resolves from a poll against /integrations/, not from a
      // driver action — inject the connected result the poll would land.
      store.setGithubConnected(true);
    } else if (screen === SelfDrivingScreenId.IntegrationDetect) {
      // The detect screen self-advances in ci by picking a project; simulate
      // that pick (framework + path) so the run phase can proceed.
      store.setFrameworkContext(SELF_DRIVING_INTEGRATE_PATH_KEY, '.');
      store.setFrameworkConfig(
        Integration.javascriptNode,
        FRAMEWORK_REGISTRY[Integration.javascriptNode],
      );
    } else if (screen === SourceMapsScreenId.Detect) {
      // The detect screen runs an agentic scan + an interactive pick; commit
      // the pick through the driver the way the e2e host injection does.
      driver.performAction('pick_source_maps_project', {
        variant: 'node',
        path: '.',
      });
    } else if (screen === ScreenId.Run || screen === AuditScreenId.Run) {
      // The run screen is shared by composed run steps (a run step naming
      // another program, e.g. self-driving's integrate-run) and the program's
      // own run. Complete the active run step the way the runner would: a
      // composed step via completeRunStep, the main run via runPhase.
      const stepId = composedRunStep(program, store);
      if (stepId) store.completeRunStep(stepId);
      else store.setRunPhase(RunPhase.Completed);
    }

    if (decision.done || store.skillsComplete) break;
  }
  return trace;
}

describe('e2e flow snapshot — posthog-integration', () => {
  const profile = profileFor(Program.PostHogIntegration);

  it('Next.js (with a setup question) walks a stable path', async () => {
    expect({
      program: 'posthog-integration',
      profile,
      trace: await traceFlow(
        Program.PostHogIntegration,
        profile,
        Integration.nextjs,
      ),
    }).toMatchSnapshot();
  });

  it('Node (no setup question) walks a stable path', async () => {
    expect({
      program: 'posthog-integration',
      trace: await traceFlow(
        Program.PostHogIntegration,
        profile,
        Integration.javascriptNode,
      ),
    }).toMatchSnapshot();
  });
});

describe('e2e flow snapshot — self-driving', () => {
  const profile = profileFor(Program.SelfDriving);

  it('integration-first (no existing PostHog) walks a stable path', async () => {
    expect({
      program: 'self-driving',
      profile,
      trace: await traceFlow(Program.SelfDriving, profile),
    }).toMatchSnapshot();
  });

  it('already-integrated (skips SDK setup) walks a stable path', async () => {
    // Same flow, answering "yes, already integrated" at the check.
    const alreadyIntegrated: WizardE2eProfile = {
      ...profile,
      integrate: false,
    };
    expect({
      program: 'self-driving',
      trace: await traceFlow(Program.SelfDriving, alreadyIntegrated),
    }).toMatchSnapshot();
  });
});

describe('e2e flow snapshot — upload-source-maps', () => {
  const profile = profileFor(Program.ErrorTrackingUploadSourceMaps);

  it('walks a stable path', async () => {
    expect({
      program: 'error-tracking-upload-source-maps',
      profile,
      trace: await traceFlow(Program.ErrorTrackingUploadSourceMaps, profile),
    }).toMatchSnapshot();
  });
});

describe('e2e flow snapshot — ai-observability', () => {
  const profile = profileFor(Program.AiObservability);

  it('walks intro → health → auth → run → outro → skills', async () => {
    expect({
      program: 'ai-observability',
      profile,
      trace: await traceFlow(
        Program.AiObservability,
        profile,
        Integration.javascriptNode,
      ),
    }).toMatchSnapshot();
  });
});

describe('e2e flow snapshot — metrics', () => {
  const profile = profileFor(Program.Metrics);

  it('walks intro → health → auth → run → outro → skills', async () => {
    expect({
      program: 'metrics',
      profile,
      trace: await traceFlow(
        Program.Metrics,
        profile,
        Integration.javascriptNode,
      ),
    }).toMatchSnapshot();
  });

  it('reaches a terminal decision instead of stalling on the intro', async () => {
    const trace = await traceFlow(
      Program.Metrics,
      profile,
      Integration.javascriptNode,
    );
    // A screen with no `decideE2eAction` case yields `(external)` forever, so
    // the guard loop runs its full 40 iterations on one screen. The metrics
    // intro must be drivable.
    expect(trace[0]).toEqual({
      screen: 'metrics-intro',
      action: 'confirm_setup',
    });
    expect(trace.at(-1)?.action).toBe('keep_skills');
    expect(trace.length).toBeLessThan(40);
  });
});

describe('e2e flow snapshot — warehouse-source', () => {
  it('walks intro → auth → run → outro → skills', async () => {
    expect({
      program: 'warehouse-source',
      profile: profileFor(Program.WarehouseSource),
      trace: await traceFlow(
        Program.WarehouseSource,
        profileFor(Program.WarehouseSource),
        Integration.javascriptNode,
      ),
    }).toMatchSnapshot();
  });

  it('reaches a terminal decision instead of stalling on the intro', async () => {
    const trace = await traceFlow(
      Program.WarehouseSource,
      profileFor(Program.WarehouseSource),
      Integration.javascriptNode,
    );
    expect(trace[0]).toEqual({
      screen: 'warehouse-intro',
      action: 'confirm_setup',
    });
    expect(trace.at(-1)?.action).toBe('keep_skills');
    expect(trace.length).toBeLessThan(40);
  });
});
