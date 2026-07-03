/**
 * Control-plane test: drive a REAL WizardStore through the full integration
 * screen sequence using only the WizardCiDriver — proving read_state is a
 * truthful projection of router-resolved state and that perform_action commits
 * cause the same transitions the interactive UI would.
 *
 * The agent/auth steps are simulated by committing through the same store the
 * runner mutates (the SDK is mocked in jest); every *human* decision goes
 * through the driver.
 */

import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession, RunPhase, McpOutcome } from '@lib/wizard-session';
import { Integration } from '@lib/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { WizardReadiness } from '@lib/health-checks/readiness';
import { ScreenId, Overlay } from '@ui/tui/router';
import { Program } from '@lib/programs/program-registry';
import { WizardCiDriver, UnknownActionError } from '../wizard-ci-driver';
import { ACTION_REGISTRY, NO_ACTION_SCREENS } from '../action-registry';
import { SOURCE_MAPS_CONTEXT_KEYS } from '@lib/programs/error-tracking-upload-source-maps/index';

function freshStore(): WizardStore {
  const store = new WizardStore(Program.PostHogIntegration);
  // Headless: a real store + InkUI (which only forwards to the store), no Ink
  // render. setUI so any getUI() path the store touches resolves.
  setUI(new InkUI(store));
  const session = buildSession({
    installDir: '/tmp/ci-driver-test',
    ci: true, // OAuth-bypass + ai-opt-in auto-consent semantics
  });
  session.integration = Integration.nextjs;
  session.frameworkConfig = FRAMEWORK_REGISTRY[Integration.nextjs];
  store.session = session;
  return store;
}

const cleanReadiness = {
  decision: WizardReadiness.Yes,
  health: {} as never,
  reasons: [] as string[],
};

describe('WizardCiDriver — full integration flow', () => {
  it('walks intro → setup → run → outro → mcp → slack → keep-skills', () => {
    const store = freshStore();
    const driver = new WizardCiDriver(store);

    // 1. Intro
    expect(driver.readState().currentScreen).toBe(ScreenId.Intro);
    expect(driver.listActions().map((a) => a.id)).toContain('confirm_setup');
    driver.performAction('confirm_setup');

    // 2. Health check — blocks until a readiness result lands (mirrors onInit
    // probe). Simulate a clean probe; router advances past it.
    expect(driver.readState().currentScreen).toBe(ScreenId.HealthCheck);
    store.setReadinessResult(cleanReadiness);

    // 3. Setup — Next.js asks for the router. The driver reads the question
    // off read_state and commits the answer via `choose`.
    const state = driver.readState();
    expect(state.currentScreen).toBe(ScreenId.Setup);
    expect(state.setupQuestions).toHaveLength(1);
    expect(state.setupQuestions[0].key).toBe('router');
    const appValue = state.setupQuestions[0].options[0].value;
    driver.performAction('choose', { key: 'router', value: appValue });

    // 4. Auth — no user action; the runner sets credentials headlessly using
    // the phx key. Simulate that commit.
    expect(driver.readState().currentScreen).toBe(ScreenId.Auth);
    store.setCredentials({
      accessToken: 'phx_secret_should_not_leak',
      projectApiKey: 'phc_public',
      host: 'https://us.posthog.com',
      projectId: 42,
    });

    // 5. ai-opt-in auto-completes (ci=true), so we land on Run. The agent runs
    // here; simulate it finishing.
    expect(driver.readState().currentScreen).toBe(ScreenId.Run);
    store.setRunPhase(RunPhase.Running);
    store.setRunPhase(RunPhase.Completed);

    // 6. Outro
    expect(driver.readState().currentScreen).toBe(ScreenId.Outro);
    driver.performAction('dismiss_outro');

    // 7. MCP
    expect(driver.readState().currentScreen).toBe(ScreenId.Mcp);
    driver.performAction('set_mcp_outcome', { outcome: 'skipped' });
    expect(store.session.mcpOutcome).toBe(McpOutcome.Skipped);

    // 8. Slack
    expect(driver.readState().currentScreen).toBe(ScreenId.SlackConnect);
    driver.performAction('dismiss_slack');

    // 9. Keep skills — terminal commit.
    expect(driver.readState().currentScreen).toBe(ScreenId.KeepSkills);
    const done = driver.performAction('keep_skills', { kept: true });

    // keep-skills is the terminal step: it has no isComplete predicate, so the
    // router rests on it. Completion is signalled by skillsComplete — the exact
    // condition run-wizard.ts awaits to end the run.
    expect(store.session.skillsComplete).toBe(true);
    expect(done.currentScreen).toBe(ScreenId.KeepSkills);
  });

  it('read_state is a truthful projection and never leaks the access token', () => {
    const store = freshStore();
    const driver = new WizardCiDriver(store);
    store.setCredentials({
      accessToken: 'phx_secret_should_not_leak',
      projectApiKey: 'phc_public',
      host: 'https://us.posthog.com',
      projectId: 7,
    });
    const state = driver.readState();
    // currentScreen always equals what the router resolves.
    expect(state.currentScreen).toBe(store.currentScreen);
    expect(state.session.hasCredentials).toBe(true);
    expect(state.session.projectId).toBe(7);
    // No raw secret anywhere in the serialized snapshot.
    expect(JSON.stringify(state)).not.toContain('phx_secret_should_not_leak');
  });

  it('rejects actions that are not legal on the current screen', () => {
    const store = freshStore();
    const driver = new WizardCiDriver(store);
    expect(driver.readState().currentScreen).toBe(ScreenId.Intro);
    expect(() => driver.performAction('keep_skills')).toThrow(
      UnknownActionError,
    );
  });
});

describe('WizardCiDriver — wizard_ask overlay', () => {
  it('answers a pending question through the driver, resolving the agent promise', async () => {
    const store = freshStore();
    const driver = new WizardCiDriver(store);

    // The agent (via the ask bridge) opens a question and awaits the answers.
    const answersPromise = store.requestQuestion({
      id: 'q1',
      source: 'integration-nextjs',
      questions: [
        {
          id: 'router',
          prompt: 'Which router?',
          kind: 'single',
          options: [
            { label: 'App', value: 'app' },
            { label: 'Pages', value: 'pages' },
          ],
        },
      ],
    });

    const state = driver.readState();
    expect(state.currentScreen).toBe(Overlay.WizardAsk);
    expect(state.hasOverlay).toBe(true);
    expect(state.pendingQuestion?.questions[0].id).toBe('router');
    expect(driver.listActions().map((a) => a.id)).toContain('answer_question');

    // The driver commits the complete answer map directly — skipping the
    // per-question keystroke walk that lives in React-local state.
    driver.performAction('answer_question', { answers: { router: 'app' } });

    await expect(answersPromise).resolves.toEqual({ router: 'app' });
    // Overlay popped; back to the underlying screen.
    expect(driver.readState().currentScreen).not.toBe(Overlay.WizardAsk);
  });
});

describe('WizardCiDriver — self-driving integration check', () => {
  function selfDrivingStore(): WizardStore {
    const store = new WizardStore(Program.SelfDriving);
    setUI(new InkUI(store));
    store.session = buildSession({ installDir: '/tmp/ci-driver-sd', ci: true });
    return store;
  }

  it('exposes the integration check and commits set_integrate', () => {
    const store = selfDrivingStore();
    const driver = new WizardCiDriver(store);

    // Intro → integration-check.
    store.completeSetup();
    const state = driver.readState();
    expect(state.currentScreen).toBe(ScreenId.SelfDrivingIntegrationCheck);
    expect(state.session.integrate).toBeNull();
    expect(state.actions.map((a) => a.id)).toContain('set_integrate');

    // Answer "no, set it up first" → integrate=true, advances off the screen.
    const next = driver.performAction('set_integrate', { integrate: true });
    expect(next.session.integrate).toBe(true);
    expect(next.currentScreen).not.toBe(ScreenId.SelfDrivingIntegrationCheck);
  });

  it('skips the integration check when --integrate pre-resolved it', () => {
    const store = selfDrivingStore();
    store.session = buildSession({
      installDir: '/tmp/ci-driver-sd',
      integrate: true,
    });
    const driver = new WizardCiDriver(store);

    store.completeSetup();
    expect(driver.readState().currentScreen).not.toBe(
      ScreenId.SelfDrivingIntegrationCheck,
    );
  });
});

describe('WizardCiDriver — source-maps project pick', () => {
  function sourceMapsStore(): WizardStore {
    const store = new WizardStore(Program.ErrorTrackingUploadSourceMaps);
    setUI(new InkUI(store));
    store.session = buildSession({ installDir: '/tmp/ci-driver-sm', ci: true });
    return store;
  }

  function toDetectScreen(store: WizardStore): void {
    // Intro → auth → detect.
    store.completeSetup();
    store.setCredentials({
      accessToken: 'phx_x',
      projectApiKey: 'phc_x',
      host: 'https://us.posthog.com',
      projectId: 1,
    });
  }

  it('commits the pick the way the detect screen would and advances', () => {
    const store = sourceMapsStore();
    const driver = new WizardCiDriver(store);

    toDetectScreen(store);
    const state = driver.readState();
    expect(state.currentScreen).toBe(ScreenId.SourceMapsDetect);
    expect(state.actions.map((a) => a.id)).toContain(
      'pick_source_maps_project',
    );

    const next = driver.performAction('pick_source_maps_project', {
      variant: 'node',
      path: '.',
    });
    const ctx = store.session.frameworkContext;
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.selectedVariant]).toBe('node');
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName]).toBe('Node.js');
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.selectedPath]).toBe('.');
    expect(next.currentScreen).toBe(ScreenId.Run);
  });

  it('requires the variant and path params', () => {
    const store = sourceMapsStore();
    const driver = new WizardCiDriver(store);

    toDetectScreen(store);
    expect(() =>
      driver.performAction('pick_source_maps_project', { variant: 'node' }),
    ).toThrow('requires param "path"');
  });
});

describe('action registry exhaustiveness', () => {
  it('every screen and overlay is either actionable or explicitly no-action', () => {
    const allScreens = [...Object.values(ScreenId), ...Object.values(Overlay)];
    const uncovered = allScreens.filter(
      (s) => !(s in ACTION_REGISTRY) && !NO_ACTION_SCREENS.has(s),
    );
    expect(uncovered).toEqual([]);
  });
});
