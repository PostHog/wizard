import { OutroKind } from '@shared/outro';
import { TaskStatus } from '@shared/task-status';
import { LoggingUI } from '../logging-ui';
import { logProgress } from '../progress-log';

it("prints a run's display lines and leaves its run state to the session store", () => {
  const lines: string[] = [];
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation((line: string) => void lines.push(line));
  try {
    const print = logProgress(new LoggingUI());
    const run = (event: Parameters<typeof print>[0]['event']) =>
      print({ runId: 'run-1', event });
    run({ kind: 'lifecycle', phase: 'started' });
    run({ kind: 'status', message: 'Installing the SDK' });
    run({
      kind: 'tasks',
      tasks: [
        {
          content: 'Install SDK',
          status: TaskStatus.InProgress,
          activeForm: 'Installing SDK',
        },
        { content: 'Done', status: TaskStatus.Completed },
      ],
    });
    run({ kind: 'handoff', text: '# Report' });
    run({ kind: 'completion', outro: { kind: OutroKind.Success } });
    run({ kind: 'lifecycle', phase: 'completed', message: 'Finished' });
    expect(lines).toEqual([
      '◇  Installing the SDK',
      '◌  [1/2] Installing SDK',
      '└  Finished',
    ]);
  } finally {
    spy.mockRestore();
  }
});
