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
import { Program } from '@lib/programs/program-registry';
import { ScreenId } from '@ui/tui/router';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration';
import { WizardCiDriver } from '../wizard-ci-driver';
import { decideE2eAction, DEFAULT_E2E_PROFILE } from '../e2e-profile';

/**
 * Walk the program flow offline using its e2e profile, injecting the external
 * transitions a real run gets from the runner (auth) and the agent (runPhase)
 * and the health probe. Returns the ordered (screen, action) trace.
 */
function traceFlow(
  integration: Integration,
): Array<{ screen: string; action: string }> {
  const store = new WizardStore(Program.PostHogIntegration);
  setUI(new InkUI(store));
  const session = buildSession({ installDir: '/tmp/e2e-snap', ci: true });
  session.integration = integration;
  session.frameworkConfig = FRAMEWORK_REGISTRY[integration];
  store.session = session;

  const driver = new WizardCiDriver(store);
  const profile = posthogIntegrationConfig.e2e ?? DEFAULT_E2E_PROFILE;

  const trace: Array<{ screen: string; action: string }> = [];
  for (let guard = 0; guard < 40; guard++) {
    const state = driver.readState();
    const screen = state.currentScreen;
    const decision = decideE2eAction(state, profile);
    trace.push({ screen, action: decision.action?.id ?? '(external)' });

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
    } else if (screen === ScreenId.Run) {
      store.setRunPhase(RunPhase.Completed);
    }

    if (decision.done || store.session.skillsComplete) break;
  }
  return trace;
}

describe('e2e flow snapshot — posthog-integration', () => {
  it('Next.js (with a setup question) walks a stable path', () => {
    expect({
      program: 'posthog-integration',
      profile: posthogIntegrationConfig.e2e,
      trace: traceFlow(Integration.nextjs),
    }).toMatchSnapshot();
  });

  it('Node (no setup question) walks a stable path', () => {
    expect({
      program: 'posthog-integration',
      trace: traceFlow(Integration.javascriptNode),
    }).toMatchSnapshot();
  });
});
