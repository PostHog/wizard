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

import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession, RunPhase } from '@lib/wizard-session';
import { Integration } from '@lib/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { WizardReadiness } from '@lib/health-checks/readiness';
import {
  Program,
  getProgramConfig,
  type ProgramId,
} from '@lib/programs/program-registry';
import { ScreenId } from '@ui/tui/router';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '@lib/programs/self-driving/detect';
import { WizardCiDriver } from '../wizard-ci-driver';
import { decideE2eAction, type WizardE2eProfile } from '../e2e-profile';
import { profileFor } from '../profiles';

/**
 * Walk a program flow offline using an e2e profile, injecting the external
 * transitions a real run gets from the runner (auth), the agent (runPhase), and
 * the health probe. Returns the ordered (screen, action) trace. Stops at the
 * terminal Exit screen or when a profile decision marks the run done.
 */
function traceFlow(
  program: ProgramId,
  profile: WizardE2eProfile,
  integration?: Integration,
): Array<{
  screen: string;
  action: string;
  params?: Record<string, unknown>;
}> {
  const store = new WizardStore(program);
  setUI(new InkUI(store));
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
        host: 'https://us.posthog.com',
        projectId: 1,
      });
    } else if (screen === ScreenId.SelfDrivingIntegrationDetect) {
      // The detect screen self-advances in ci by picking a project; simulate
      // that pick (framework + path) so the run phase can proceed.
      store.setFrameworkContext(SELF_DRIVING_INTEGRATE_PATH_KEY, '.');
      store.setFrameworkConfig(
        Integration.javascriptNode,
        FRAMEWORK_REGISTRY[Integration.javascriptNode],
      );
    } else if (screen === ScreenId.Run) {
      // The run screen is shared by in-program run phases (steps with
      // `runProgram`, e.g. self-driving's integrate-run) and the main run. If
      // the active run step is such a phase, simulate completePhase; otherwise
      // complete the main run.
      const steps = getProgramConfig(store.router.activeProgram).steps;
      const runStep = steps.find(
        (s) =>
          s.screenId === 'run' &&
          (!s.show || s.show(store.session)) &&
          (!s.isComplete || !s.isComplete(store.session)),
      );
      if (runStep?.runProgram) {
        store.completePhase(runStep.id);
      } else {
        store.setRunPhase(RunPhase.Completed);
      }
    }

    if (decision.done || store.session.skillsComplete) break;
  }
  return trace;
}

describe('e2e flow snapshot — posthog-integration', () => {
  const profile = profileFor(Program.PostHogIntegration);

  it('Next.js (with a setup question) walks a stable path', () => {
    expect({
      program: 'posthog-integration',
      profile,
      trace: traceFlow(Program.PostHogIntegration, profile, Integration.nextjs),
    }).toMatchSnapshot();
  });

  it('Node (no setup question) walks a stable path', () => {
    expect({
      program: 'posthog-integration',
      trace: traceFlow(
        Program.PostHogIntegration,
        profile,
        Integration.javascriptNode,
      ),
    }).toMatchSnapshot();
  });
});

describe('e2e flow snapshot — self-driving', () => {
  const profile = profileFor(Program.SelfDriving);

  it('integration-first (no existing PostHog) walks a stable path', () => {
    expect({
      program: 'self-driving',
      profile,
      trace: traceFlow(Program.SelfDriving, profile),
    }).toMatchSnapshot();
  });

  it('already-integrated (skips SDK setup) walks a stable path', () => {
    // Same flow, answering "yes, already integrated" at the check.
    const alreadyIntegrated: WizardE2eProfile = {
      ...profile,
      integrate: false,
    };
    expect({
      program: 'self-driving',
      trace: traceFlow(Program.SelfDriving, alreadyIntegrated),
    }).toMatchSnapshot();
  });
});
