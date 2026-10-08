import { tuiView } from '@tui/__tests__/helpers/tui-view.no-jest';
import { RunPhase } from '@shared/run-state';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { programSequence, ScreenId } from '@tui/screen-sequences';
import { Program, type ProgramId } from '@programs';
import { McpScreenId } from '@tui/tools/mcp';
import { SourceMapsScreenId } from '@tui/programs/error-tracking-upload-source-maps';
import { Tool } from '@tools';

function getEntry(program: ProgramId, id: string) {
  const entry = programSequence(program).find(
    (candidate) => candidate.id === id,
  );
  if (!entry) {
    throw new Error(`Missing program entry for ${program}:${id}`);
  }
  return entry;
}

describe('programSequence', () => {
  describe('Wizard setup predicate', () => {
    it('hides setup when there are no setup questions', () => {
      const view = tuiView({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.Setup);

      expect(entry.show?.(view)).toBe(false);
      expect(entry.isComplete?.(view)).toBe(true);
    });

    it('shows setup when framework questions are missing answers', () => {
      const view = tuiView({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.Setup);

      view.session.frameworkConfig = {
        metadata: {
          setup: {
            questions: [{ key: 'packageManager' }, { key: 'srcDir' }],
          },
        },
      } as never;
      view.session.frameworkContext = { packageManager: 'pnpm' };

      expect(entry.show?.(view)).toBe(true);
      expect(entry.isComplete?.(view)).toBe(false);
    });

    it('marks setup complete once all required answers are present', () => {
      const view = tuiView({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.Setup);

      view.session.frameworkConfig = {
        metadata: {
          setup: {
            questions: [{ key: 'packageManager' }, { key: 'srcDir' }],
          },
        },
      } as never;
      view.session.frameworkContext = {
        packageManager: 'pnpm',
        srcDir: 'src',
      };

      expect(entry.show?.(view)).toBe(false);
      expect(entry.isComplete?.(view)).toBe(true);
    });
  });

  describe('Wizard health-check predicate', () => {
    it('completes immediately for non-blocking readiness', () => {
      const view = tuiView({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.HealthCheck);

      view.session.readinessResult = {
        decision: WizardReadiness.YesWithWarnings,
        health: {} as never,
        reasons: [],
      };

      expect(entry.isComplete?.(view)).toBe(true);
    });
  });

  describe('Source maps flow', () => {
    it('detect screen stays incomplete until a project is selected', () => {
      const entry = getEntry(
        Program.ErrorTrackingUploadSourceMaps,
        SourceMapsScreenId.Detect,
      );
      const view = tuiView({});

      expect(entry.isComplete?.(view)).toBe(false);

      view.session.frameworkContext = { sourceMapsSelectedVariant: 'nextjs' };
      expect(entry.isComplete?.(view)).toBe(true);
    });
  });

  describe('AI opt-in gate predicate', () => {
    const orgWith = (
      is_ai_data_processing_approved: boolean | null | undefined,
    ) =>
      ({
        organization: { is_ai_data_processing_approved },
      } as never);

    it('hides the gate while apiUser is null (transient between emits)', () => {
      const view = tuiView({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(view.session.apiUser).toBeNull();
      expect(entry.show?.(view)).toBe(false);
      expect(entry.isComplete?.(view)).toBe(false);
    });

    it('hides the gate when the org has opted in (true)', () => {
      const view = tuiView({});
      view.session.apiUser = orgWith(true);
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(entry.show?.(view)).toBe(false);
      expect(entry.isComplete?.(view)).toBe(true);
    });

    it('shows the gate when the org has explicitly opted out (false)', () => {
      const view = tuiView({});
      view.session.apiUser = orgWith(false);
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(entry.show?.(view)).toBe(true);
      expect(entry.isComplete?.(view)).toBe(false);
    });

    it('shows the gate when the field is null (legacy org, matches Max)', () => {
      const view = tuiView({});
      view.session.apiUser = orgWith(null);
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(entry.show?.(view)).toBe(true);
      expect(entry.isComplete?.(view)).toBe(false);
    });

    it('shows the gate when the field is undefined (matches Max)', () => {
      const view = tuiView({});
      view.session.apiUser = orgWith(undefined);
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(entry.show?.(view)).toBe(true);
      expect(entry.isComplete?.(view)).toBe(false);
    });

    it('is omitted entirely from a tool flow, even one with an auth step', () => {
      // A tool runs no agent, so withAiOptInGate never injects the gate.
      const entry = programSequence(Tool.PosthogDoctor).find(
        (e) => e.id === ScreenId.AiOptIn,
      );
      expect(entry).toBeUndefined();
    });

    it('skips the gate in CI mode regardless of opt-in state', () => {
      // CI users have already auto-consented to AI usage per the README,
      // and the interactive kill screen would be unworkable headless.
      const view = tuiView({});
      view.session.ci = true;
      view.session.apiUser = orgWith(false);
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(entry.show?.(view)).toBe(false);
      expect(entry.isComplete?.(view)).toBe(true);
    });

    it('skips the gate in signup mode regardless of opt-in state', () => {
      // A provisioned account's token omits `organization:read`, so the org's
      // AI approval can never be read back. Creating an account through the
      // wizard to run the agent is itself the consent — signup auto-consents
      // like CI, so the gate must never block it.
      const view = tuiView({});
      view.session.signup = true;
      view.session.apiUser = orgWith(false);
      const entry = getEntry(Program.SelfDriving, ScreenId.AiOptIn);

      expect(entry.show?.(view)).toBe(false);
      expect(entry.isComplete?.(view)).toBe(true);
    });

    it('skips the gate in signup mode even when apiUser is null', () => {
      const view = tuiView({});
      view.session.signup = true;
      const entry = getEntry(Program.SelfDriving, ScreenId.AiOptIn);

      expect(view.session.apiUser).toBeNull();
      expect(entry.show?.(view)).toBe(false);
      expect(entry.isComplete?.(view)).toBe(true);
    });
  });

  describe('Wizard run predicate', () => {
    it('stays incomplete while run is idle or running', () => {
      const view = tuiView({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.Run);

      view.session.runPhase = RunPhase.Idle;
      expect(entry.isComplete?.(view)).toBe(false);

      view.session.runPhase = RunPhase.Running;
      expect(entry.isComplete?.(view)).toBe(false);
    });

    it('completes when run finishes or errors', () => {
      const view = tuiView({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.Run);

      view.session.runPhase = RunPhase.Completed;
      expect(entry.isComplete?.(view)).toBe(true);

      view.session.runPhase = RunPhase.Error;
      expect(entry.isComplete?.(view)).toBe(true);
    });
  });

  describe('MCP flow predicates', () => {
    it('uses mcpComplete for McpAdd', () => {
      const view = tuiView({});
      const entry = getEntry(Tool.McpAdd, McpScreenId.Add);

      expect(entry.isComplete?.(view)).toBe(false);

      view.mcpComplete = true;

      expect(entry.isComplete?.(view)).toBe(true);
    });

    it('uses mcpComplete for McpRemove', () => {
      const view = tuiView({});
      const entry = getEntry(Tool.McpRemove, McpScreenId.Remove);

      expect(entry.isComplete?.(view)).toBe(false);

      view.mcpComplete = true;

      expect(entry.isComplete?.(view)).toBe(true);
    });
  });
});
