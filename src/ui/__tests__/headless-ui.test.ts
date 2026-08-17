// Load @ui first so the logging-ui → readiness → debug → @ui import cycle
// resolves in the order the app uses (@ui before logging-ui). Importing
// HeadlessUI as the entry otherwise hits `new LoggingUI()` in @ui before
// logging-ui has finished initializing.
import '@ui';
import { HeadlessUI } from '../headless-ui';
import { TaskStatus } from '../wizard-ui';
import type { WizardStore } from '../tui/store';

describe('HeadlessUI', () => {
  it('forwards task updates to the store and still logs to the console', () => {
    const syncTodos = vi.fn();
    const store = { syncTodos } as unknown as WizardStore;
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
