import { buildSession, McpOutcome, RunPhase } from '@lib/wizard-session';
import { WizardReadiness } from '@lib/health-checks/readiness';
import { WizardRouter, ScreenId, Overlay, Program } from '@ui/tui/router';
import { Integration } from '@lib/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';

function baseWizardSession() {
  return buildSession({});
}

describe('WizardRouter', () => {
  describe('resolve', () => {
    it('returns the first incomplete visible screen for the wizard flow', () => {
      const router = new WizardRouter(Program.PostHogIntegration);
      const session = baseWizardSession();

      expect(router.resolve(session)).toBe(ScreenId.Intro);

      session.setupConfirmed = true;
      session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      session.credentials = {
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://app.posthog.com',
        projectId: 1,
      };

      expect(router.resolve(session)).toBe(ScreenId.Run);
    });

    it('skips the setup screen when there are no unanswered framework questions', () => {
      const router = new WizardRouter(Program.PostHogIntegration);
      const session = baseWizardSession();

      session.setupConfirmed = true;
      session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      session.frameworkConfig = {
        metadata: {
          setup: {
            questions: [{ key: 'packageManager' }],
          },
        },
      } as never;
      session.frameworkContext = { packageManager: 'pnpm' };

      expect(router.resolve(session)).toBe(ScreenId.Auth);
    });

    it('returns the last flow screen when every entry is complete', () => {
      const router = new WizardRouter(Program.PostHogIntegration);
      const session = baseWizardSession();

      session.setupConfirmed = true;
      session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      session.credentials = {
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://app.posthog.com',
        projectId: 1,
      };
      session.runPhase = RunPhase.Completed;
      session.mcpComplete = true;
      session.slackStepDismissed = true;

      expect(router.resolve(session)).toBe(ScreenId.Outro);
    });

    it('gives the topmost overlay precedence over the flow screen', () => {
      const router = new WizardRouter(Program.PostHogIntegration);
      const session = baseWizardSession();

      router.pushOverlay(Overlay.SettingsOverride);
      router.pushOverlay(Overlay.AuthError);

      expect(router.resolve(session)).toBe(Overlay.AuthError);

      router.popOverlay();
      expect(router.resolve(session)).toBe(Overlay.SettingsOverride);
    });

    it('shows the session-timeout overlay over the auth screen that never completes', () => {
      // On OAuth timeout the user has no credentials, so the auth step's
      // isComplete gate never passes and resolve() is pinned on Auth. The
      // overlay must take precedence, otherwise the spinner shows forever.
      const router = new WizardRouter(Program.PostHogIntegration);
      const session = baseWizardSession();

      session.setupConfirmed = true;
      session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      expect(router.resolve(session)).toBe(ScreenId.Auth);

      router.pushOverlay(Overlay.SessionTimeout);
      expect(router.resolve(session)).toBe(Overlay.SessionTimeout);
    });
  });

  describe('activeScreen', () => {
    it('defaults to the first screen in the active flow', () => {
      const router = new WizardRouter(Program.McpRemove);

      expect(router.activeScreen).toBe(ScreenId.McpRemove);
    });

    it('returns the top overlay when overlays are active', () => {
      const router = new WizardRouter(Program.PostHogIntegration);

      router.pushOverlay(Overlay.ManagedSettings);

      expect(router.activeScreen).toBe(Overlay.ManagedSettings);
    });
  });

  describe('McpAdd flow', () => {
    it('starts at McpAdd', () => {
      const router = new WizardRouter(Program.McpAdd);
      expect(router.activeScreen).toBe(ScreenId.McpAdd);
    });

    it('exits after install when MCP install was skipped', () => {
      const router = new WizardRouter(Program.McpAdd);
      const session = baseWizardSession();
      session.mcpComplete = true;
      session.mcpOutcome = McpOutcome.Skipped;

      // Skipped → tutorial step is hidden, so the only visible
      // step (mcp-add) is complete and the program resolves to Exit.
      expect(router.resolve(session)).toBe(ScreenId.Exit);
    });

    it('advances to SlackConnect after a successful install', () => {
      const router = new WizardRouter(Program.McpAdd);
      const session = baseWizardSession();
      session.mcpComplete = true;
      session.mcpOutcome = McpOutcome.Installed;

      // Slack is the first post-install step (loginless render); the
      // tutorial follows it.
      expect(router.resolve(session)).toBe(ScreenId.SlackConnect);
    });

    it('advances to McpSuggestedPrompts once the Slack step is dismissed', () => {
      const router = new WizardRouter(Program.McpAdd);
      const session = baseWizardSession();
      session.mcpComplete = true;
      session.mcpOutcome = McpOutcome.Installed;
      session.slackStepDismissed = true;

      expect(router.resolve(session)).toBe(ScreenId.McpSuggestedPrompts);
    });

    it('exits once the tutorial step is dismissed', () => {
      const router = new WizardRouter(Program.McpAdd);
      const session = baseWizardSession();
      session.mcpComplete = true;
      session.mcpOutcome = McpOutcome.Installed;
      session.slackStepDismissed = true;
      session.mcpSuggestedPromptsDismissed = true;

      expect(router.resolve(session)).toBe(ScreenId.Exit);
    });

    it('skips the Slack step when MCP install was skipped', () => {
      const router = new WizardRouter(Program.McpAdd);
      const session = baseWizardSession();
      session.mcpComplete = true;
      session.mcpOutcome = McpOutcome.Skipped;

      // Both the tutorial and slack-connect steps are gated on a
      // successful install, so a skipped install resolves straight to Exit.
      expect(router.resolve(session)).toBe(ScreenId.Exit);
    });
  });

  describe('self-driving integration-check', () => {
    function confirmed() {
      const session = baseWizardSession();
      session.setupConfirmed = true; // self-driving intro confirmed
      return session;
    }

    it('asks "set up PostHog?" when none detected and undecided', () => {
      const router = new WizardRouter(Program.SelfDriving);
      const session = confirmed(); // integrate null, postHogPresent unset
      expect(router.resolve(session)).toBe(
        ScreenId.SelfDrivingIntegrationCheck,
      );
    });

    it('skips the question when PostHog is already detected', () => {
      const router = new WizardRouter(Program.SelfDriving);
      const session = confirmed();
      session.frameworkContext.postHogPresent = true;
      expect(router.resolve(session)).toBe(ScreenId.HealthCheck);
    });

    it('skips the question when --integrate pre-decided it', () => {
      const router = new WizardRouter(Program.SelfDriving);
      const session = confirmed();
      session.integrate = true;
      expect(router.resolve(session)).toBe(ScreenId.HealthCheck);
    });

    function readyToIntegrate() {
      const session = confirmed();
      session.integrate = true;
      session.readinessResult = {
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      };
      session.credentials = {
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://app.posthog.com',
        projectId: 1,
      };
      return session;
    }

    it('shows the detect+pick screen after auth, before a project is picked', () => {
      const router = new WizardRouter(Program.SelfDriving);
      const session = readyToIntegrate(); // integration still null
      expect(router.resolve(session)).toBe(
        ScreenId.SelfDrivingIntegrationDetect,
      );
    });

    it('advances to the integration run once a project is picked', () => {
      const router = new WizardRouter(Program.SelfDriving);
      const session = readyToIntegrate();
      session.integration = Integration.javascriptNode; // picked
      session.frameworkConfig = FRAMEWORK_REGISTRY[Integration.javascriptNode];
      // integrate-run shares the 'run' screen; the phase hasn't completed yet.
      expect(router.resolve(session)).toBe(ScreenId.Run);
    });
  });
});
