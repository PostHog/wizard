import { buildSession, RunPhase } from '@lib/wizard-session';
import { WizardReadiness } from '@lib/health-checks/readiness';
import { WizardRouter, ScreenId, Overlay, Program } from '@ui/tui/router';

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
});
