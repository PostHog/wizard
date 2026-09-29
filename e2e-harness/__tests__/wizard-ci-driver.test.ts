/**
 * Control-plane test: drive the target `createTuiTarget` builds through the
 * full integration screen sequence using only the WizardCiDriver — proving
 * read_state is a truthful projection of router-resolved state and that
 * perform_action commits cause the same transitions the interactive UI would.
 *
 * The agent/auth steps are simulated by the target's setters, the writes the
 * runner makes; every *human* decision goes through the driver. That a commit
 * resolves the agent's pending promise is locked by the TUI's control tests.
 */

import { RunPhase } from '@shared/run-state';
import { Integration } from '@shared/constants';
import type { ControlTarget } from '@shared/control/types';
import { Program, type ProgramId } from '@programs';
import { WizardReadiness } from '@shared/health-checks/readiness';
import {
  createTuiTarget,
  Overlay,
  PostHogIntegrationScreenId,
  ScreenId,
  SelfDrivingScreenId,
  SourceMapsScreenId,
} from '@tui';
import { WizardCiDriver, UnknownActionError } from '../wizard-ci-driver';
import { SOURCE_MAPS_CONTEXT_KEYS } from '@programs/error-tracking-upload-source-maps';
import { OutroKind } from '@shared/outro';

/** Call a full-control setter on the target by name. */
function set(
  target: ControlTarget,
  name: string,
  params: Record<string, unknown> = {},
): void {
  const setter = target.setters().find((s) => s.name === name);
  if (!setter) throw new Error(`No control setter named ${name}`);
  setter.apply(params);
}

/** A headless target: no Ink render. */
async function freshTarget(
  program: ProgramId = Program.PostHogIntegration,
  installDir = '/tmp/ci-driver-test',
  choices: { integrate?: boolean } = {},
): Promise<ControlTarget> {
  const target = await createTuiTarget(program, {
    installDir,
    ci: true, // OAuth-bypass + ai-opt-in auto-consent semantics
    ...choices,
  });
  if (program === Program.PostHogIntegration) {
    set(target, 'setFrameworkConfig', { integration: Integration.nextjs });
  }
  return target;
}

const credentials = (projectId: number) => ({
  accessToken: 'phx_secret_should_not_leak',
  projectApiKey: 'phc_public',
  apiHost: 'https://us.posthog.com',
  projectId,
});

const cleanReadiness = {
  decision: WizardReadiness.Yes,
  health: {},
  reasons: [] as string[],
};

describe('WizardCiDriver — full integration flow', () => {
  it('lets a failed run exit or continue to MCP', async () => {
    const target = await freshTarget();
    const driver = new WizardCiDriver(target);
    set(target, 'setCredentials', credentials(42));
    set(target, 'setOutroDismissed');
    set(target, 'setOutroData', {
      data: { kind: OutroKind.Error, message: 'agent failed' },
    });
    set(target, 'setRunPhase', { phase: RunPhase.Error });
    expect(driver.readState().currentScreen).toBe(ScreenId.MintFailure);
    driver.performAction('continue_setup');
    expect(driver.readState().currentScreen).toBe(ScreenId.Mcp);
    driver.performAction('set_mcp_outcome', { outcome: 'skipped' });
    driver.performAction('dismiss_slack');
    expect(driver.readState().currentScreen).toBe(ScreenId.KeepSkills);
    driver.performAction('keep_skills', { kept: true });
    expect(driver.readState().currentScreen).toBe(ScreenId.Exit);
  });

  it('walks intro → setup → run → outro → mcp → slack → keep-skills', async () => {
    const target = await freshTarget();
    const driver = new WizardCiDriver(target);

    // 1. Intro
    expect(driver.readState().currentScreen).toBe(
      PostHogIntegrationScreenId.Intro,
    );
    expect(driver.listActions().map((a) => a.id)).toContain('confirm_setup');
    driver.performAction('confirm_setup');

    // 2. Health check — blocks until a readiness result lands (mirrors onInit
    // probe). Simulate a clean probe; router advances past it.
    expect(driver.readState().currentScreen).toBe(ScreenId.HealthCheck);
    set(target, 'setReadinessResult', { result: cleanReadiness });

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
    set(target, 'setCredentials', credentials(42));

    // 5. ai-opt-in auto-completes (ci=true), so we land on Run. The agent runs
    // here; simulate it finishing.
    expect(driver.readState().currentScreen).toBe(ScreenId.Run);
    set(target, 'setRunPhase', { phase: RunPhase.Running });
    set(target, 'setRunPhase', { phase: RunPhase.Completed });

    // 6. Outro
    expect(driver.readState().currentScreen).toBe(ScreenId.Outro);
    driver.performAction('dismiss_outro');

    // 7. MCP
    expect(driver.readState().currentScreen).toBe(ScreenId.Mcp);
    const afterMcp = driver.performAction('set_mcp_outcome', {
      outcome: 'skipped',
    });
    expect(afterMcp.session.mcpComplete).toBe(true);

    // 8. Slack
    expect(driver.readState().currentScreen).toBe(ScreenId.SlackConnect);
    driver.performAction('dismiss_slack');

    // 9. Keep skills — terminal commit.
    expect(driver.readState().currentScreen).toBe(ScreenId.KeepSkills);
    const done = driver.performAction('keep_skills', { kept: true });

    // keep-skills is the terminal step: it has no isComplete predicate, so the
    // router rests on it. Completion is signalled by skillsComplete — the exact
    // condition run-wizard.ts awaits to end the run.
    expect(done.session.skillsComplete).toBe(true);
    expect(done.currentScreen).toBe(ScreenId.KeepSkills);
  });

  it('read_state is a truthful projection and never leaks the access token', async () => {
    const target = await freshTarget();
    const driver = new WizardCiDriver(target);
    set(target, 'setCredentials', credentials(7));
    const state = driver.readState();
    // currentScreen always equals what the router resolves.
    expect(state.currentScreen).toBe(target.readState().currentScreen);
    expect(state.session.hasCredentials).toBe(true);
    expect(state.session.projectId).toBe(7);
    // No raw secret anywhere in the serialized snapshot.
    expect(JSON.stringify(state)).not.toContain('phx_secret_should_not_leak');
  });

  it('rejects actions that are not legal on the current screen', async () => {
    const driver = new WizardCiDriver(await freshTarget());
    expect(driver.readState().currentScreen).toBe(
      PostHogIntegrationScreenId.Intro,
    );
    expect(() => driver.performAction('keep_skills')).toThrow(
      UnknownActionError,
    );
  });
});

describe('WizardCiDriver — wizard_ask overlay', () => {
  it('answers a pending question through the driver', async () => {
    const target = await freshTarget();
    const driver = new WizardCiDriver(target);

    // The agent (via the ask bridge) opens a question and awaits the answers.
    set(target, 'requestQuestion', {
      question: {
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
      },
    });

    const state = driver.readState();
    expect(state.currentScreen).toBe(Overlay.WizardAsk);
    expect(state.hasOverlay).toBe(true);
    expect(state.pendingQuestion?.questions[0].id).toBe('router');
    expect(driver.listActions().map((a) => a.id)).toContain('answer_question');

    // The driver commits the complete answer map directly — skipping the
    // per-question keystroke walk that lives in React-local state.
    driver.performAction('answer_question', { answers: { router: 'app' } });

    // Overlay popped; back to the underlying screen.
    expect(driver.readState().currentScreen).not.toBe(Overlay.WizardAsk);
  });
});

describe('WizardCiDriver — self-driving integration check', () => {
  it('exposes the integration check and commits set_integrate', async () => {
    const target = await freshTarget(Program.SelfDriving, '/tmp/ci-driver-sd');
    const driver = new WizardCiDriver(target);

    // Intro → integration-check.
    set(target, 'completeSetup');
    const state = driver.readState();
    expect(state.currentScreen).toBe(SelfDrivingScreenId.IntegrationCheck);
    expect(state.session.integrate).toBeNull();
    expect(state.actions.map((a) => a.id)).toContain('set_integrate');

    // Answer "no, set it up first" → integrate=true, advances off the screen.
    const next = driver.performAction('set_integrate', { integrate: true });
    expect(next.session.integrate).toBe(true);
    expect(next.currentScreen).not.toBe(SelfDrivingScreenId.IntegrationCheck);
  });

  it('skips the integration check when --integrate pre-resolved it', async () => {
    const target = await createTuiTarget(Program.SelfDriving, {
      installDir: '/tmp/ci-driver-sd',
      integrate: true,
    });
    const driver = new WizardCiDriver(target);

    set(target, 'completeSetup');
    expect(driver.readState().currentScreen).not.toBe(
      SelfDrivingScreenId.IntegrationCheck,
    );
  });
});

describe('WizardCiDriver — source-maps project pick', () => {
  async function toDetectScreen(): Promise<ControlTarget> {
    const target = await freshTarget(
      Program.ErrorTrackingUploadSourceMaps,
      '/tmp/ci-driver-sm',
    );
    // Intro → auth → detect.
    set(target, 'completeSetup');
    set(target, 'setCredentials', {
      accessToken: 'phx_x',
      projectApiKey: 'phc_x',
      apiHost: 'https://us.posthog.com',
      projectId: 1,
    });
    return target;
  }

  it('commits the pick the way the detect screen would and advances', async () => {
    const target = await toDetectScreen();
    const driver = new WizardCiDriver(target);

    const state = driver.readState();
    expect(state.currentScreen).toBe(SourceMapsScreenId.Detect);
    expect(state.actions.map((a) => a.id)).toContain(
      'pick_source_maps_project',
    );

    const next = driver.performAction('pick_source_maps_project', {
      variant: 'node',
      path: '.',
    });
    const ctx = target.readState().session.frameworkContext as Record<
      string,
      unknown
    >;
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.selectedVariant]).toBe('node');
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName]).toBe('Node.js');
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.selectedPath]).toBe('.');
    expect(next.currentScreen).toBe(ScreenId.Run);
  });

  it('requires the variant and path params', async () => {
    const driver = new WizardCiDriver(await toDetectScreen());
    expect(() =>
      driver.performAction('pick_source_maps_project', { variant: 'node' }),
    ).toThrow('requires param "path"');
  });
});

describe('WizardCiDriver — task-notice overlay', () => {
  const notice = {
    title: 'Connect your data sources',
    body: ['We detected some warehouse sources.'],
    items: ['Postgres', 'Stripe'],
    confirmLabel: 'Continue [Enter]',
    cancelLabel: 'Skip [Esc]',
    prompt: 'Connect these during setup?',
  };

  it('projects the notice into read_state and keeps the step', async () => {
    const target = await freshTarget();
    const driver = new WizardCiDriver(target);

    set(target, 'showTaskNotice', { notice });

    const state = driver.readState();
    expect(state.currentScreen).toBe(Overlay.TaskNotice);
    expect(state.taskNotice).toEqual({
      title: 'Connect your data sources',
      items: ['Postgres', 'Stripe'],
      prompt: 'Connect these during setup?',
    });
    expect(driver.listActions().map((a) => a.id)).toContain('resolve_notice');

    driver.performAction('resolve_notice', { keep: true });

    expect(driver.readState().taskNotice).toBeNull();
    expect(driver.readState().currentScreen).not.toBe(Overlay.TaskNotice);
  });

  it('projects an empty items list when the notice has none', async () => {
    const target = await freshTarget();
    const driver = new WizardCiDriver(target);
    set(target, 'showTaskNotice', { notice: { ...notice, items: undefined } });
    expect(driver.readState().taskNotice?.items).toEqual([]);
  });
});
