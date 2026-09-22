import { completionFailure, nudgeWhileUnfinished } from '../completion';
import { AgentErrorType, runErrorType } from '@lib/agent/signals';

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

describe('runErrorType', () => {
  it('reads a rate limit out of the thrown message', () => {
    expect(runErrorType('429 Too Many Requests')).toBe(
      AgentErrorType.RATE_LIMIT,
    );
    expect(runErrorType('Gateway rate limit exceeded')).toBe(
      AgentErrorType.RATE_LIMIT,
    );
    expect(runErrorType('RATE LIMIT reached')).toBe(AgentErrorType.RATE_LIMIT);
  });

  it('falls back to a generic API error', () => {
    expect(runErrorType('socket hang up')).toBe(AgentErrorType.API_ERROR);
    expect(runErrorType('')).toBe(AgentErrorType.API_ERROR);
  });
});

describe('nudgeWhileUnfinished', () => {
  const run = (args: {
    max: number;
    unfinished: () => boolean;
    progress: () => number;
    send: (nudge: number) => Promise<void>;
  }) => nudgeWhileUnfinished({ ...args, backoffMs: 0 });

  it('stops on the first nudge that produces no tool call and no output', async () => {
    let sent = 0;
    const result = await run({
      max: 20,
      unfinished: () => true,
      // Work never advances: every nudge came back empty.
      progress: () => 0,
      send: () => {
        sent += 1;
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ nudges: 1, dead: true });
    expect(sent).toBe(1);
  });

  it('keeps nudging while each nudge does work, then stops when finished', async () => {
    let work = 0;
    let open = 3;
    const result = await run({
      max: 20,
      unfinished: () => open > 0,
      progress: () => work,
      send: () => {
        work += 1;
        open -= 1;
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ nudges: 3, dead: false });
  });

  it('never sends more nudges than the cap', async () => {
    let work = 0;
    const result = await run({
      max: 4,
      unfinished: () => true,
      progress: () => work,
      send: () => {
        work += 1;
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ nudges: 4, dead: false });
  });

  it('sends nothing when the work is already finished', async () => {
    const send = vi.fn();
    const result = await run({
      max: 20,
      unfinished: () => false,
      progress: () => 0,
      send: () => {
        send();
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ nudges: 0, dead: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('waits between live nudges instead of spinning', async () => {
    let work = 0;
    let open = 3;
    const started = Date.now();
    const result = await nudgeWhileUnfinished({
      max: 20,
      backoffMs: 20,
      unfinished: () => open > 0,
      progress: () => work,
      send: () => {
        work += 1;
        open -= 1;
        return Promise.resolve();
      },
    });
    expect(result.nudges).toBe(3);
    // Two waits between three nudges.
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });
});
