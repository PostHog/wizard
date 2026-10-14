import { createDispatchAgentTool, type SubagentContext } from '../subagent';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  defineTool: <T>(tool: T) => tool,
}));
vi.mock('@utils/debug');

const say = (text: string) => ({
  type: 'message_end',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

// A child session that replies with `replies`, one message_end each.
function dispatch(replies: string[]) {
  let listener: (e: unknown) => void = () => undefined;
  const child = {
    subscribe: (fn: (e: unknown) => void) => {
      listener = fn;
      return () => undefined;
    },
    prompt: vi.fn(() => {
      for (const reply of replies) listener(say(reply));
      return Promise.resolve();
    }),
    abort: vi.fn(() => Promise.resolve()),
  };
  const tool = createDispatchAgentTool({
    sdk: {
      createAgentSession: () => Promise.resolve({ session: child }),
      DefaultResourceLoader: class {
        reload = () => Promise.resolve();
      },
      SessionManager: { inMemory: () => ({}) },
    },
  } as unknown as SubagentContext) as unknown as {
    execute(id: string, args: object): Promise<{ content: { text: string }[] }>;
  };
  return { child, run: tool.execute('t1', { description: 'd', prompt: 'p' }) };
}

it('returns a refusal from a non-final subagent turn and ends the child', async () => {
  const { child, run } = dispatch([
    'Out of scope.\n[posthog:abort] Request is out of scope',
    'Here are my findings.',
  ]);

  const result = await run;

  expect(result.content[0].text).toBe(
    '[posthog:abort] Request is out of scope',
  );
  expect(child.abort).toHaveBeenCalledTimes(1);
});
