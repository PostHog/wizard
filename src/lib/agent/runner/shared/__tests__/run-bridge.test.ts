// errors.ts (imported transitively by run-bridge) pulls AgentErrorType from
// agent-interface, which loads the full agent stack. Stub it — the bridge reads
// the canonical enum from signals.ts directly, which we assert against.
jest.mock('../../../agent-interface', () => ({
  AgentErrorType: {
    RATE_LIMIT: 'WIZARD_RATE_LIMIT',
    API_ERROR: 'WIZARD_API_ERROR',
  },
}));

import { RunBridge, type BridgeUI, type BridgeSpinner } from '../run-bridge';
import { AgentErrorType } from '../../../signals';
import type { TaskEntry } from '../tools/types';

function makeUI() {
  const calls = {
    status: [] as string[],
    dashboard: [] as string[],
    notebook: [] as string[],
    todos: [] as Array<Array<{ content: string; status: string }>>,
  };
  const ui: BridgeUI = {
    pushStatus: (m) => calls.status.push(m),
    setDashboardUrl: (u) => calls.dashboard.push(u),
    setNotebookUrl: (u) => calls.notebook.push(u),
    syncTodos: (t) =>
      calls.todos.push(
        t.map((x) => ({ content: x.content, status: x.status })),
      ),
  };
  const spinnerMsgs: string[] = [];
  const spinner: BridgeSpinner = { message: (m) => spinnerMsgs.push(m ?? '') };
  return { ui, spinner, calls, spinnerMsgs };
}

describe('RunBridge.handleAssistantText', () => {
  it('surfaces [STATUS] to the status feed and spinner', () => {
    const { ui, spinner, calls, spinnerMsgs } = makeUI();
    const bridge = new RunBridge(ui, spinner);
    bridge.handleAssistantText('Working… [STATUS] installing the SDK');
    expect(calls.status).toEqual(['installing the SDK']);
    expect(spinnerMsgs).toEqual(['installing the SDK']);
  });

  it('captures [DASHBOARD_URL] and [NOTEBOOK_URL] tokens', () => {
    const { ui, spinner, calls } = makeUI();
    const bridge = new RunBridge(ui, spinner);
    bridge.handleAssistantText('[DASHBOARD_URL] https://us.posthog.com/dash/1');
    bridge.handleAssistantText('[NOTEBOOK_URL] https://us.posthog.com/nb/2');
    expect(calls.dashboard).toEqual(['https://us.posthog.com/dash/1']);
    expect(calls.notebook).toEqual(['https://us.posthog.com/nb/2']);
  });

  it('returns the [ABORT] reason and latches it', () => {
    const { ui, spinner } = makeUI();
    const bridge = new RunBridge(ui, spinner);
    expect(
      bridge.handleAssistantText('cannot continue\n[ABORT] missing key'),
    ).toEqual({
      abort: 'missing key',
    });
    // A later non-abort block keeps the first reason.
    expect(bridge.handleAssistantText('more text').abort).toBe('missing key');
    expect(bridge.abort).toBe('missing key');
  });
});

describe('RunBridge.syncTasks', () => {
  it('orders todos completed → in_progress → pending, stable within a group', () => {
    const { ui, spinner, calls } = makeUI();
    const bridge = new RunBridge(ui, spinner);
    const tasks = new Map<string, TaskEntry>([
      ['1', { content: 'a', status: 'pending' }],
      ['2', { content: 'b', status: 'completed' }],
      ['3', { content: 'c', status: 'in_progress' }],
      ['4', { content: 'd', status: 'pending' }],
    ]);
    bridge.syncTasks(tasks);
    expect(calls.todos[0].map((t) => t.content)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('RunBridge.finalize', () => {
  const build = (text: string) => {
    const { ui, spinner } = makeUI();
    const bridge = new RunBridge(ui, spinner);
    bridge.handleAssistantText(text);
    return bridge;
  };

  it('returns {} on a clean run', () => {
    expect(build('all good').finalize()).toEqual({});
  });

  it('maps a YARA violation', () => {
    expect(build('[YARA CRITICAL] secret leak').finalize().error).toBe(
      AgentErrorType.YARA_VIOLATION,
    );
  });

  it('maps a missing MCP signal', () => {
    expect(build('[ERROR-MCP-MISSING]').finalize().error).toBe(
      AgentErrorType.MCP_MISSING,
    );
  });

  it('maps API Error 429 to RATE_LIMIT', () => {
    const result = build('API Error: 429 too many requests').finalize();
    expect(result.error).toBe(AgentErrorType.RATE_LIMIT);
    expect(result.message).toContain('429');
  });

  it('maps other API errors to API_ERROR', () => {
    expect(build('API Error: 500 boom').finalize().error).toBe(
      AgentErrorType.API_ERROR,
    );
  });

  it('prefers abort over other signals', () => {
    const result = build('[ABORT] stop now\nAPI Error: 500').finalize();
    expect(result.error).toBe(AgentErrorType.ABORT);
    expect(result.message).toBe('stop now');
  });

  it('extracts the end-of-run remark', () => {
    expect(build('[WIZARD-REMARK] the docs were great').remark()).toBe(
      'the docs were great',
    );
  });
});
