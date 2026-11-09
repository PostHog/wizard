import {
  createPostHogToolHook,
  posthogExecBlockReason,
} from '@agent/posthog-tool-policy';

vi.mock('@utils/debug');

describe('createPostHogToolHook', () => {
  const hook = createPostHogToolHook(
    ['batch-export-get', 'batch-export-create'],
    'posthog-wizard',
  ).hooks[0];
  const run = (tool_name: unknown, tool_input: unknown) =>
    hook({ tool_name, tool_input }, undefined, {
      signal: new AbortController().signal,
    });

  test.each([
    [
      'exec call on the list',
      'mcp__posthog-wizard__exec',
      { command: 'call batch-export-get {}' },
    ],
    [
      'exec discovery',
      'mcp__posthog-wizard__exec',
      { command: 'info batch-export-delete' },
    ],
    ['direct tool on the list', 'mcp__posthog-wizard__batch-export-create', {}],
    ['wizard-tools server', 'mcp__wizard-tools__set_env_values', {}],
    [
      'another MCP server',
      'mcp__external__exec',
      { command: 'call batch-export-delete {}' },
    ],
    ['built-in tool', 'Bash', { command: 'ls' }],
  ])('allows %s', async (_name, tool, input) => {
    expect(await run(tool, input)).toEqual({});
  });

  test.each([
    [
      'exec call off the list',
      'mcp__posthog-wizard__exec',
      { command: 'call batch-export-delete {}' },
      'batch-export-delete',
    ],
    [
      'exec prefix trick',
      'mcp__posthog-wizard__exec',
      { command: 'call batch-export-get-all {}' },
      'batch-export-get-all',
    ],
    [
      'exec malformed',
      'mcp__posthog-wizard__exec',
      { command: '' },
      'not allowed',
    ],
    [
      'exec without input',
      'mcp__posthog-wizard__exec',
      undefined,
      'not allowed',
    ],
    [
      'direct tool off the list',
      'mcp__posthog-wizard__batch-export-update',
      {},
      'batch-export-update',
    ],
  ])('blocks %s', async (_name, tool, input, reason) => {
    expect(await run(tool, input)).toEqual({
      decision: 'block',
      reason: expect.stringContaining(reason),
    });
  });
});

describe('posthogExecBlockReason', () => {
  const allowed = ['batch-export-get', 'batch-export-create'];

  test.each([
    ['a listed call', 'call batch-export-get {"id":"x"}'],
    ['a listed call with --json', 'call --json batch-export-get {}'],
    [
      'a listed call with two flags',
      'call --json --confirm batch-export-create {}',
    ],
    ['extra whitespace', '  call   batch-export-get   {}  '],
    ['help', 'help'],
    ['tools', 'tools'],
    ['search', 'search batch-export'],
    ['info of any tool', 'info --json batch-export-delete'],
    ['schema of any tool', 'schema batch-export-create destination'],
  ])('allows %s', (_name, command) => {
    expect(posthogExecBlockReason({ command }, allowed)).toBeUndefined();
  });

  test.each([
    ['an unlisted call', 'call batch-export-delete {}'],
    ['an unlisted call behind a flag', 'call --confirm batch-export-delete {}'],
    ['a prefix of a listed name', 'call batch-export {}'],
    ['a listed name with a suffix', 'call batch-export-getx {}'],
    ['a call with only flags', 'call --json'],
    ['a call with no tool', 'call'],
    ['an unknown verb', 'delete batch-export-get'],
    ['an empty command', ''],
  ])('blocks %s', (_name, command) => {
    expect(posthogExecBlockReason({ command }, allowed)).toBeDefined();
  });

  it('blocks a command that is not a string', () => {
    expect(posthogExecBlockReason({ command: 7 }, allowed)).toBeDefined();
  });
});
