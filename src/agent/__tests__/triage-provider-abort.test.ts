import { Harness } from '@shared/constants';
import { OperatorAbort } from '../output-signals';
import { createTriageLLMProvider } from '../triage-provider';

vi.mock('@utils/debug');

const reply = vi.hoisted(() => ({ text: '' }));
vi.mock('@earendil-works/pi-ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@earendil-works/pi-ai')>()),
  completeSimple: () =>
    Promise.resolve({
      content: [{ type: 'text', text: reply.text }],
      stopReason: 'stop',
    }),
}));

const auth = {
  baseURL: 'http://127.0.0.1:1',
  authToken: 'phe_test',
  systemPrompt: 'PINNED',
};

describe('YARA triage reply', () => {
  it('ends the run when it carries the abort marker anywhere', async () => {
    const operatorAbort = new OperatorAbort();
    const seen = vi.fn();
    operatorAbort.watch(seen);
    reply.text = 'Verdict follows.\n[posthog:abort] Not allowed.\nthanks';
    const triage = createTriageLLMProvider(auth, Harness.pi, operatorAbort);

    await expect(triage('verdict?')).rejects.toThrow();

    expect(seen).toHaveBeenCalledWith('Not allowed.');
  });

  it('returns the verdict and leaves the run alone without the marker', async () => {
    const operatorAbort = new OperatorAbort();
    reply.text = '{"verdict":"true_positive"}';
    const triage = createTriageLLMProvider(auth, Harness.pi, operatorAbort);

    await expect(triage('verdict?')).resolves.toBe(reply.text);

    expect(operatorAbort.reason).toBeUndefined();
  });
});
