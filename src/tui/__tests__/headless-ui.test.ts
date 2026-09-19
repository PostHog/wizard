import { HeadlessUI } from '../console/headless-ui.js';
import { TaskStatus } from '@store/ui/wizard-ui';
import type { FlowStore } from '@store/state/store';

describe('HeadlessUI', () => {
  it('forwards task updates to the store and still logs to the console', () => {
    const syncTodos = vi.fn();
    const store = { syncTodos } as unknown as FlowStore;
    const ui = new HeadlessUI(store);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const todos = [
      {
        content: 'Install SDK',
        status: TaskStatus.InProgress,
        activeForm: 'Installing SDK',
      },
      { content: 'Done', status: TaskStatus.Completed },
    ];
    ui.syncTodos(todos);

    expect(syncTodos).toHaveBeenCalledWith(todos);
    // LoggingUI.syncTodos logs the active task line, so console output is kept.
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
