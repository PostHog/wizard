import { operatorAbortReason } from '@agent/output-signals';
import { createDispatchAgentTool } from '../subagent';

vi.mock('@utils/debug');

const PINNED = 'PINNED';

/** A subagent whose only turn is `reply`; returns what the parent was told. */
async function dispatch(reply: string) {
  let refusal: string | undefined;
  const abort = vi.fn(() => Promise.resolve());
  let handler: (event: unknown) => void = () => undefined;
  const sdk = {
    DefaultResourceLoader: class {
      reload() {
        return Promise.resolve();
      }
    },
    SessionManager: { inMemory: () => ({}) },
    createAgentSession: () =>
      Promise.resolve({
        session: {
          subscribe: (fn: (event: unknown) => void) => {
            handler = fn;
            return () => undefined;
          },
          prompt: () => {
            handler({
              type: 'message_end',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: reply }],
                stopReason: 'stop',
              },
            });
            return Promise.resolve();
          },
          abort,
        },
      }),
  };
  const tool = createDispatchAgentTool({
    model: {} as never,
    modelRegistry: {} as never,
    cwd: '/tmp',
    agentDir: '/tmp',
    securityFactory: (() => undefined) as never,
    operatorPrompt: () => undefined,
    refuseOnText: (text) => {
      refusal = operatorAbortReason(text, PINNED);
      return refusal !== undefined;
    },
    bashTool: {} as never,
    sdk: sdk as never,
  });
  await tool.execute(
    'id',
    { description: 'look', prompt: 'find it' },
    undefined,
    undefined,
    undefined as never,
  );
  return { refusal, abort };
}

describe('subagent reply', () => {
  it('ends the run when it carries the abort marker mid-reply', async () => {
    const { refusal, abort } = await dispatch(
      'Findings so far.\n[posthog:abort] Out of scope.\nDone.',
    );
    expect(refusal).toBe('Out of scope.');
    expect(abort).toHaveBeenCalledOnce();
  });

  it('lets a reply without the marker through', async () => {
    const { refusal, abort } = await dispatch('Found it in src/app.ts.');
    expect(refusal).toBeUndefined();
    expect(abort).not.toHaveBeenCalled();
  });
});
