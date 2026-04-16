import { buildSession, RunPhase } from '../../../lib/wizard-session.js';
import { WizardReadiness } from '../../../lib/health-checks/readiness.js';
import { FLOWS, Flow, Screen } from '../flows.js';

function getEntry(flow: Flow, screen: Screen) {
  const entry = FLOWS[flow].find((candidate) => candidate.screen === screen);
  if (!entry) {
    throw new Error(`Missing flow entry for ${flow}:${screen}`);
  }
  return entry;
}

describe('FLOWS', () => {
  describe('Wizard setup predicate', () => {
    it('hides setup when there are no setup questions', () => {
      const session = buildSession({});
      const entry = getEntry(Flow.PostHogIntegration, Screen.Setup);

      expect(entry.show?.(session)).toBe(false);
      expect(entry.isComplete?.(session)).toBe(true);
    });

    it('shows setup when framework questions are missing answers', () => {
      const session = buildSession({});
      const entry = getEntry(Flow.PostHogIntegration, Screen.Setup);

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
      const entry = getEntry(Flow.PostHogIntegration, Screen.Setup);

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
      const entry = getEntry(Flow.PostHogIntegration, Screen.HealthCheck);

      expect(entry.isComplete?.(session)).toBe(false);
    });

    it('stays incomplete for blocking readiness until outage is dismissed', () => {
      const session = buildSession({});
      const entry = getEntry(Flow.PostHogIntegration, Screen.HealthCheck);

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
      const entry = getEntry(Flow.PostHogIntegration, Screen.HealthCheck);

      session.readinessResult = {
        decision: WizardReadiness.YesWithWarnings,
        health: {} as never,
        reasons: [],
      };

      expect(entry.isComplete?.(session)).toBe(true);
    });
  });

  describe('Wizard run predicate', () => {
    it('stays incomplete while run is idle or running', () => {
      const session = buildSession({});
      const entry = getEntry(Flow.PostHogIntegration, Screen.Run);

      session.runPhase = RunPhase.Idle;
      expect(entry.isComplete?.(session)).toBe(false);

      session.runPhase = RunPhase.Running;
      expect(entry.isComplete?.(session)).toBe(false);
    });

    it('completes when run finishes or errors', () => {
      const session = buildSession({});
      const entry = getEntry(Flow.PostHogIntegration, Screen.Run);

      session.runPhase = RunPhase.Completed;
      expect(entry.isComplete?.(session)).toBe(true);

      session.runPhase = RunPhase.Error;
      expect(entry.isComplete?.(session)).toBe(true);
    });
  });

  describe('MCP flow predicates', () => {
    it('uses mcpComplete for McpAdd', () => {
      const session = buildSession({});
      const entry = getEntry(Flow.McpAdd, Screen.McpAdd);

      expect(entry.isComplete?.(session)).toBe(false);

      session.mcpComplete = true;

      expect(entry.isComplete?.(session)).toBe(true);
    });

    it('uses mcpComplete for McpRemove', () => {
      const session = buildSession({});
      const entry = getEntry(Flow.McpRemove, Screen.McpRemove);

      expect(entry.isComplete?.(session)).toBe(false);

      session.mcpComplete = true;

      expect(entry.isComplete?.(session)).toBe(true);
    });
  });
});
