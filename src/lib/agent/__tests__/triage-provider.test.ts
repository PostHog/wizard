import { completeSimple } from '@earendil-works/pi-ai';
import { createTriageLLMProvider } from '@lib/agent/triage-provider';
import { GPT5_6_LUNA_MODEL, HAIKU_TRIAGE_MODEL, Harness } from '@lib/constants';
import { triageModelFor } from '@lib/agent/runner/switchboard/models';

vi.mock('@earendil-works/pi-ai', () => ({ completeSimple: vi.fn() }));
const complete = vi.mocked(completeSimple);

const AUTH = { baseURL: 'https://gw.posthog.test', authToken: 'tok' };
const reply = (text: string) =>
  ({ content: [{ type: 'text', text }] } as never);

beforeEach(() => {
  complete.mockReset();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

describe('triage model routing', () => {
  it('binds each harness to the cheap model of the line it already speaks', () => {
    expect(triageModelFor(Harness.anthropic)).toBe(HAIKU_TRIAGE_MODEL);
    expect(triageModelFor(Harness.pi)).toBe(GPT5_6_LUNA_MODEL);
  });
});

describe('createTriageLLMProvider', () => {
  it('returns undefined with no auth so the caller fails closed', () => {
    expect(createTriageLLMProvider(undefined, Harness.pi)).toBeUndefined();
  });

  it('falls back to the anthropic gateway env when no auth is passed', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://env.posthog.test';
    process.env.ANTHROPIC_AUTH_TOKEN = 'env-tok';
    expect(createTriageLLMProvider(undefined, Harness.anthropic)).toBeDefined();
  });

  it('triages a pi run on luna at the table effort, over openai-completions', async () => {
    complete.mockResolvedValue(reply('true_positive'));
    const provider = createTriageLLMProvider(AUTH, Harness.pi)!;

    await expect(provider('verdict?')).resolves.toBe('true_positive');

    const [model, context, options] = complete.mock.calls[0];
    expect(model.id).toBe(GPT5_6_LUNA_MODEL);
    expect(model.api).toBe('openai-completions');
    // openai-completions keeps /v1; the SDK appends the route.
    expect(model.baseUrl).toBe('https://gw.posthog.test/v1');
    // Luna rejects the request without an effort it recognises.
    expect(options?.reasoning).toBe('low');
    expect(context.messages[0].content).toBe('verdict?');
  });

  it('triages an anthropic run on haiku over anthropic-messages', async () => {
    complete.mockResolvedValue(reply('false_positive'));
    const provider = createTriageLLMProvider(AUTH, Harness.anthropic)!;

    await expect(provider('verdict?')).resolves.toBe('false_positive');

    const [model] = complete.mock.calls[0];
    expect(model.id).toBe(HAIKU_TRIAGE_MODEL);
    expect(model.api).toBe('anthropic-messages');
    expect(model.baseUrl).toBe('https://gw.posthog.test');
  });

  it('carries the same gateway trace headers as every other model call', async () => {
    complete.mockResolvedValue(reply(''));
    const provider = createTriageLLMProvider(
      {
        ...AUTH,
        wizardMetadata: { run_id: 'r1' },
        wizardFlags: { 'wizard-orchestrator': 'true' },
      },
      Harness.pi,
    )!;

    await provider('verdict?');

    expect(complete.mock.calls[0][0].headers).toMatchObject({
      'x-posthog-use-bedrock-fallback': 'true',
      'X-POSTHOG-PROPERTY-run_id': 'r1',
      'X-POSTHOG-FLAG-WIZARD-ORCHESTRATOR': 'true',
    });
  });

  it('keeps only text blocks in the verdict', async () => {
    complete.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'weighing it' },
        { type: 'text', text: 'false_positive' },
      ],
    } as never);
    const provider = createTriageLLMProvider(AUTH, Harness.pi)!;
    await expect(provider('verdict?')).resolves.toBe('false_positive');
  });
});
