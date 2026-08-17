import { completionFailure } from '../completion';
import { AgentErrorType } from '@lib/agent/signals';

describe('completionFailure', () => {
  it('fails a no-op run (zero tool calls) as NO_PROGRESS', () => {
    expect(completionFailure({ toolCalls: 0, openTasks: false })).toBe(
      AgentErrorType.NO_PROGRESS,
    );
    // Zero tool calls dominates even if the (empty) task store looks open.
    expect(completionFailure({ toolCalls: 0, openTasks: true })).toBe(
      AgentErrorType.NO_PROGRESS,
    );
  });

  it('fails a run that left its own tasks open as INCOMPLETE_TASKS', () => {
    expect(completionFailure({ toolCalls: 12, openTasks: true })).toBe(
      AgentErrorType.INCOMPLETE_TASKS,
    );
  });

  // Sarah's scenarios: a run that acted and closed out its plan must NOT fail
  // just because it didn't call install_skill this run.
  describe("does not fail valid runs that don't install a skill this run", () => {
    it('reused a skill installed on a previous run', () => {
      expect(
        completionFailure({ toolCalls: 20, openTasks: false }),
      ).toBeUndefined();
    });

    it('ran a program that does not use the skill workflow', () => {
      expect(
        completionFailure({ toolCalls: 8, openTasks: false }),
      ).toBeUndefined();
    });

    it('completed the work through a different valid approach', () => {
      expect(
        completionFailure({ toolCalls: 5, openTasks: false }),
      ).toBeUndefined();
    });
  });
});
