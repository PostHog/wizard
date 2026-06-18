import { buildSession, McpOutcome, RunPhase } from '@lib/wizard-session';
import { WizardReadiness } from '@lib/health-checks/readiness';
import { PROGRAM_SEQUENCES, ScreenId } from '@ui/tui/screen-sequences';
import { Program, type ProgramId } from '@lib/programs/program-registry';

function getEntry(program: ProgramId, id: ScreenId) {
  const entry = PROGRAM_SEQUENCES[program].find(
    (candidate) => candidate.id === id,
  );
  if (!entry) {
    throw new Error(`Missing program entry for ${program}:${id}`);
  }
  return entry;
}

describe('PROGRAM_SEQUENCES', () => {
  describe('Wizard setup predicate', () => {
    it('hides setup when there are no setup questions', () => {
      const session = buildSession({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.Setup);

      expect(entry.show?.(session)).toBe(false);
      expect(entry.isComplete?.(session)).toBe(true);
    });

    it('shows setup when framework questions are missing answers', () => {
      const session = buildSession({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.Setup);

      session.frameworkConfig = {
        metadata: {
          setup: {
            questions: [{ key: 'packageManager' }, { key: 'srcDir' }],
          },
        },
      } as never;
      session.frameworkContext = { packageManager: 'pnpm' };

      expect(entry.show?.(session)).toBe(true);
      expect(entry.isComplete?.(session)).toBe(false);
    });

    it('marks setup complete once all required answers are present', () => {
      const session = buildSession({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.Setup);

      session.frameworkConfig = {
        metadata: {
          setup: {
            questions: [{ key: 'packageManager' }, { key: 'srcDir' }],
          },
        },
      } as never;
      session.frameworkContext = {
        packageManager: 'pnpm',
        srcDir: 'src',
      };

      expect(entry.show?.(session)).toBe(false);
      expect(entry.isComplete?.(session)).toBe(true);
    });
  });

  describe('Wizard health-check predicate', () => {
    it('stays incomplete before readiness exists', () => {
      const session = buildSession({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.HealthCheck);

      expect(entry.isComplete?.(session)).toBe(false);
    });

    it('stays incomplete for blocking readiness until outage is dismissed', () => {
      const session = buildSession({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.HealthCheck);

      session.readinessResult = {
        decision: WizardReadiness.No,
        health: {} as never,
        reasons: ['Anthropic: down'],
      };

      expect(entry.isComplete?.(session)).toBe(false);

      session.outageDismissed = true;

      expect(entry.isComplete?.(session)).toBe(true);
    });

    it('completes immediately for non-blocking readiness', () => {
      const session = buildSession({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.HealthCheck);

      session.readinessResult = {
        decision: WizardReadiness.YesWithWarnings,
        health: {} as never,
        reasons: [],
      };

      expect(entry.isComplete?.(session)).toBe(true);
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
      const session = buildSession({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(session.apiUser).toBeNull();
      expect(entry.show?.(session)).toBe(false);
      expect(entry.isComplete?.(session)).toBe(false);
    });

    it('hides the gate when the org has opted in (true)', () => {
      const session = buildSession({});
      session.apiUser = orgWith(true);
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(entry.show?.(session)).toBe(false);
      expect(entry.isComplete?.(session)).toBe(true);
    });

    it('shows the gate when the org has explicitly opted out (false)', () => {
      const session = buildSession({});
      session.apiUser = orgWith(false);
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(entry.show?.(session)).toBe(true);
      expect(entry.isComplete?.(session)).toBe(false);
    });

    it('shows the gate when the field is null (legacy org, matches Max)', () => {
      const session = buildSession({});
      session.apiUser = orgWith(null);
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(entry.show?.(session)).toBe(true);
      expect(entry.isComplete?.(session)).toBe(false);
    });

    it('shows the gate when the field is undefined (matches Max)', () => {
      const session = buildSession({});
      session.apiUser = orgWith(undefined);
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(entry.show?.(session)).toBe(true);
      expect(entry.isComplete?.(session)).toBe(false);
    });

    it('is omitted entirely from programs with requiresAi: false', () => {
      // posthog-doctor sets requiresAi: false — withAiOptInGate should skip
      // injection so the gate never appears in the sequence.
      const entry = PROGRAM_SEQUENCES[Program.PosthogDoctor].find(
        (e) => e.id === ScreenId.AiOptIn,
      );
      expect(entry).toBeUndefined();
    });

    it('skips the gate in CI mode regardless of opt-in state', () => {
      // CI users have already auto-consented to AI usage per the README,
      // and the interactive kill screen would be unworkable headless.
      const session = buildSession({});
      session.ci = true;
      session.apiUser = orgWith(false);
      const entry = getEntry(Program.PostHogIntegration, ScreenId.AiOptIn);

      expect(entry.show?.(session)).toBe(false);
      expect(entry.isComplete?.(session)).toBe(true);
    });
  });

  describe('Wizard run predicate', () => {
    it('stays incomplete while run is idle or running', () => {
      const session = buildSession({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.Run);

      session.runPhase = RunPhase.Idle;
      expect(entry.isComplete?.(session)).toBe(false);

      session.runPhase = RunPhase.Running;
      expect(entry.isComplete?.(session)).toBe(false);
    });

    it('completes when run finishes or errors', () => {
      const session = buildSession({});
      const entry = getEntry(Program.PostHogIntegration, ScreenId.Run);

      session.runPhase = RunPhase.Completed;
      expect(entry.isComplete?.(session)).toBe(true);

      session.runPhase = RunPhase.Error;
      expect(entry.isComplete?.(session)).toBe(true);
    });
  });

  describe('MCP flow predicates', () => {
    it('uses mcpComplete for McpAdd', () => {
      const session = buildSession({});
      const entry = getEntry(Program.McpAdd, ScreenId.McpAdd);

      expect(entry.isComplete?.(session)).toBe(false);

      session.mcpComplete = true;

      expect(entry.isComplete?.(session)).toBe(true);
    });

    it('uses mcpComplete for McpRemove', () => {
      const session = buildSession({});
      const entry = getEntry(Program.McpRemove, ScreenId.McpRemove);

      expect(entry.isComplete?.(session)).toBe(false);

      session.mcpComplete = true;

      expect(entry.isComplete?.(session)).toBe(true);
    });

    describe('McpAdd step ordering', () => {
      // Slack-connect must run before the tutorial: the no-creds Slack render
      // is the only post-install step that can render in mcp-add (a loginless
      // command), so it sits between install and the tutorial. Ordering it
      // after the tutorial would also bury Slack discovery behind a tutorial
      // dismissal screen.
      it('runs install → slack-connect → mcp-suggested-prompts', () => {
        const order = PROGRAM_SEQUENCES[Program.McpAdd]
          .map((entry) => entry.id)
          .filter((id) => id !== ScreenId.Exit);

        expect(order).toEqual([
          ScreenId.McpAdd,
          ScreenId.SlackConnect,
          ScreenId.McpSuggestedPrompts,
        ]);
      });
    });

    describe('McpAdd → mcp-suggested-prompts step', () => {
      it('hides the step when MCP install was skipped', () => {
        const session = buildSession({});
        session.mcpOutcome = McpOutcome.Skipped;
        const entry = getEntry(Program.McpAdd, ScreenId.McpSuggestedPrompts);

        expect(entry.show?.(session)).toBe(false);
      });

      it('hides the step when no MCP clients were detected', () => {
        const session = buildSession({});
        session.mcpOutcome = McpOutcome.NoClients;
        const entry = getEntry(Program.McpAdd, ScreenId.McpSuggestedPrompts);

        expect(entry.show?.(session)).toBe(false);
      });

      it('hides the step when MCP install failed', () => {
        const session = buildSession({});
        session.mcpOutcome = McpOutcome.Failed;
        const entry = getEntry(Program.McpAdd, ScreenId.McpSuggestedPrompts);

        expect(entry.show?.(session)).toBe(false);
      });

      it('shows the step when MCP was installed', () => {
        const session = buildSession({});
        session.mcpOutcome = McpOutcome.Installed;
        const entry = getEntry(Program.McpAdd, ScreenId.McpSuggestedPrompts);

        expect(entry.show?.(session)).toBe(true);
      });

      it('is incomplete until the user dismisses', () => {
        const session = buildSession({});
        session.mcpOutcome = McpOutcome.Installed;
        const entry = getEntry(Program.McpAdd, ScreenId.McpSuggestedPrompts);

        expect(entry.isComplete?.(session)).toBe(false);

        session.mcpSuggestedPromptsDismissed = true;

        expect(entry.isComplete?.(session)).toBe(true);
      });
    });
  });
});
