import { tuiView } from '@tui/__tests__/helpers/tui-view.no-jest';
import { McpOutcome, RunPhase } from '@shared/run-state';
import { OutroKind } from '@shared/outro';
import { HostResolution } from '@shared/host-resolution';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { WizardRouter, ScreenId, Overlay, Program } from '@tui/router';
import { Integration } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import { FRAMEWORK_REGISTRY, PROGRAM_REGISTRY } from '@programs';
import { ErrorTrackingScreenId } from '@tui/programs/error-tracking';
import { McpScreenId } from '@tui/tools/mcp';
import { PostHogIntegrationScreenId } from '@tui/programs/posthog-integration';
import { SelfDrivingScreenId } from '@tui/programs/self-driving';
import { Tool, TOOL_REGISTRY } from '@tools';

function baseView() {
  return tuiView({});
}

/** An agent run that ended in an error: credentials set, error outro shown. */
function failedRunView() {
  const view = baseView();
  view.session.credentials = {
    accessToken: 'tok',
    projectApiKey: 'pk',
    host: HostResolution.fromApiHost('https://app.posthog.com'),
    projectId: 1,
  };
  view.session.outroData = { kind: OutroKind.Error, message: 'agent failed' };
  return view;
}

describe('WizardRouter', () => {
  it.each([...PROGRAM_REGISTRY, ...TOOL_REGISTRY].map((program) => program.id))(
    'shows and dismisses an early error before setup completes in %s',
    (program) => {
      const router = new WizardRouter(program);
      const view = baseView();
      view.session.runPhase = RunPhase.Error;
      view.session.outroData = {
        kind: OutroKind.Error,
        message: 'detection failed',
      };

      expect(router.resolve(view)).toBe(ScreenId.Outro);
      view.outroDismissed = true;
      expect(router.resolve(view)).toBe(ScreenId.Exit);
    },
  );

  it.each([...PROGRAM_REGISTRY, ...TOOL_REGISTRY].map((program) => program.id))(
    'shows a failed run over every step and overlay in %s',
    (program) => {
      const router = new WizardRouter(program);
      router.pushOverlay(Overlay.WizardAsk);
      const view = failedRunView();
      view.outroDismissed = true;
      expect(router.resolve(view)).toBe(ScreenId.MintFailure);
    },
  );

  it('shows a security stop on its own outro, never the busy handoff', () => {
    const router = new WizardRouter(Program.PostHogIntegration);
    const view = failedRunView();
    view.session.outroData = {
      kind: OutroKind.Error,
      message: 'Security check stopped the setup.',
      errorCode: ErrorCodes.AgentYaraViolation,
    };
    expect(router.resolve(view)).not.toBe(ScreenId.MintFailure);
  });

  it('continues a failed run through the post-run steps, then exits', () => {
    const router = new WizardRouter(Program.SelfDriving);
    const view = failedRunView();
    view.mintHandoff = 'continue';
    expect(router.resolve(view)).toBe(ScreenId.Mcp);
    view.mcpComplete = true;
    expect(router.resolve(view)).toBe(ScreenId.KeepSkills);
    view.skillsComplete = true;
    expect(router.resolve(view)).toBe(ScreenId.Exit);
    view.mintHandoff = 'exit';
    expect(router.resolve(view)).toBe(ScreenId.Exit);
  });

  describe('resolve', () => {
    it('returns the first incomplete visible screen for the wizard flow', () => {
      const router = new WizardRouter(Program.PostHogIntegration);
      const view = baseView();

      expect(router.resolve(view)).toBe(PostHogIntegrationScreenId.Intro);

      view.setupConfirmed = true;
      view.session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      view.session.credentials = {
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('https://app.posthog.com'),
        projectId: 1,
      };

      expect(router.resolve(view)).toBe(ScreenId.Run);
    });

    it('skips the setup screen when there are no unanswered framework questions', () => {
      const router = new WizardRouter(Program.PostHogIntegration);
      const view = baseView();

      view.setupConfirmed = true;
      view.session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      view.session.frameworkConfig = {
        metadata: {
          setup: {
            questions: [{ key: 'packageManager' }],
          },
        },
      } as never;
      view.session.frameworkContext = { packageManager: 'pnpm' };

      expect(router.resolve(view)).toBe(ScreenId.Auth);
    });

    // Every login failure path (OAuth denied, missing completion scope, no
    // project access) calls wizardAbort, which renders the error outro and
    // then waits for its dismissal. Credentials never arrive, so the auth
    // step never completes — without the reroute the auth spinner stays up
    // and that wait deadlocks.
    it('routes a failed login to the error outro instead of parking on auth', () => {
      const router = new WizardRouter(Program.PostHogIntegration);
      const view = baseView();

      view.setupConfirmed = true;
      view.session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      expect(router.resolve(view)).toBe(ScreenId.Auth);

      // An error phase alone (no outro yet) stays on auth.
      view.session.runPhase = RunPhase.Error;
      expect(router.resolve(view)).toBe(ScreenId.Auth);

      view.session.outroData = {
        kind: OutroKind.Error,
        message: 'login failed',
      };
      expect(router.resolve(view)).toBe(ScreenId.Outro);
    });

    it('returns the last flow screen when every entry is complete', () => {
      const router = new WizardRouter(Program.PostHogIntegration);
      const view = baseView();

      view.setupConfirmed = true;
      view.session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      view.session.credentials = {
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('https://app.posthog.com'),
        projectId: 1,
      };
      view.session.runPhase = RunPhase.Completed;
      view.mcpComplete = true;
      view.slackStepDismissed = true;

      expect(router.resolve(view)).toBe(ScreenId.Outro);
    });

    it('gives the topmost overlay precedence over the flow screen', () => {
      const router = new WizardRouter(Program.PostHogIntegration);
      const view = baseView();

      router.pushOverlay(Overlay.SettingsOverride);
      router.pushOverlay(Overlay.AuthError);

      expect(router.resolve(view)).toBe(Overlay.AuthError);

      router.popOverlay();
      expect(router.resolve(view)).toBe(Overlay.SettingsOverride);
    });

    it('shows the session-timeout overlay over the auth screen that never completes', () => {
      // On OAuth timeout the user has no credentials, so the auth step's
      // isComplete gate never passes and resolve() is pinned on Auth. The
      // overlay must take precedence, otherwise the spinner shows forever.
      const router = new WizardRouter(Program.PostHogIntegration);
      const view = baseView();

      view.setupConfirmed = true;
      view.session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      expect(router.resolve(view)).toBe(ScreenId.Auth);

      router.pushOverlay(Overlay.SessionTimeout);
      expect(router.resolve(view)).toBe(Overlay.SessionTimeout);
    });
  });

  describe('activeScreen', () => {
    it('defaults to the first screen in the active flow', () => {
      const router = new WizardRouter(Tool.McpRemove);

      expect(router.activeScreen).toBe(McpScreenId.Remove);
    });

    it('returns the top overlay when overlays are active', () => {
      const router = new WizardRouter(Program.PostHogIntegration);

      router.pushOverlay(Overlay.ManagedSettings);

      expect(router.activeScreen).toBe(Overlay.ManagedSettings);
    });
  });

  describe('McpAdd flow', () => {
    it('starts at McpAdd', () => {
      const router = new WizardRouter(Tool.McpAdd);
      expect(router.activeScreen).toBe(McpScreenId.Add);
    });

    it('exits after install when MCP install was skipped', () => {
      const router = new WizardRouter(Tool.McpAdd);
      const view = baseView();
      view.mcpComplete = true;
      view.mcpOutcome = McpOutcome.Skipped;

      // Skipped → tutorial step is hidden, so the only visible
      // step (mcp-add) is complete and the program resolves to Exit.
      expect(router.resolve(view)).toBe(ScreenId.Exit);
    });

    it('advances to McpSuggestedPrompts after a successful install', () => {
      const router = new WizardRouter(Tool.McpAdd);
      const view = baseView();
      view.mcpComplete = true;
      view.mcpOutcome = McpOutcome.Installed;

      expect(router.resolve(view)).toBe(McpScreenId.SuggestedPrompts);
    });

    it('exits once the tutorial step is dismissed', () => {
      const router = new WizardRouter(Tool.McpAdd);
      const view = baseView();
      view.mcpComplete = true;
      view.mcpOutcome = McpOutcome.Installed;
      view.mcpSuggestedPromptsDismissed = true;

      expect(router.resolve(view)).toBe(ScreenId.Exit);
    });
  });

  describe('self-driving integration-check', () => {
    function confirmed() {
      const view = baseView();
      view.setupConfirmed = true; // self-driving intro confirmed
      return view;
    }

    it('asks "set up PostHog?" when none detected and undecided', () => {
      const router = new WizardRouter(Program.SelfDriving);
      const view = confirmed(); // integrate null, postHogPresent unset
      expect(router.resolve(view)).toBe(SelfDrivingScreenId.IntegrationCheck);
    });

    it('skips the question when PostHog is already detected', () => {
      const router = new WizardRouter(Program.SelfDriving);
      const view = confirmed();
      view.session.frameworkContext.postHogPresent = true;
      expect(router.resolve(view)).toBe(ScreenId.HealthCheck);
    });

    it('skips the question when --integrate pre-decided it', () => {
      const router = new WizardRouter(Program.SelfDriving);
      const view = confirmed();
      view.integrate = true;
      expect(router.resolve(view)).toBe(ScreenId.HealthCheck);
    });

    function readyToIntegrate() {
      const view = confirmed();
      view.integrate = true;
      view.session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      view.session.credentials = {
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('https://app.posthog.com'),
        projectId: 1,
      };
      return view;
    }

    it('shows the detect+pick screen after auth, before a project is picked', () => {
      const router = new WizardRouter(Program.SelfDriving);
      const view = readyToIntegrate(); // integration still null
      expect(router.resolve(view)).toBe(SelfDrivingScreenId.IntegrationDetect);
    });

    it('advances to the integration run once a project is picked', () => {
      const router = new WizardRouter(Program.SelfDriving);
      const view = readyToIntegrate();
      view.session.integration = Integration.javascriptNode; // picked
      view.session.frameworkConfig =
        FRAMEWORK_REGISTRY[Integration.javascriptNode];
      // integrate-run shares the 'run' screen; the phase hasn't completed yet.
      expect(router.resolve(view)).toBe(ScreenId.Run);
    });
  });

  describe('error-tracking project picker', () => {
    function loggedIn() {
      const view = baseView();
      view.setupConfirmed = true;
      view.session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      view.session.credentials = {
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('https://app.posthog.com'),
        projectId: 1,
      };
      return view;
    }

    it('shows the project picker after login, before a project is picked', () => {
      const router = new WizardRouter(Program.ErrorTracking);
      expect(router.resolve(loggedIn())).toBe(ErrorTrackingScreenId.Detect);
    });

    it('advances to the run once a project is picked', () => {
      const router = new WizardRouter(Program.ErrorTracking);
      const view = loggedIn();
      view.session.integration = Integration.nextjs;
      view.session.frameworkConfig = FRAMEWORK_REGISTRY[Integration.nextjs];
      expect(router.resolve(view)).toBe(ScreenId.Run);
    });
  });
});
