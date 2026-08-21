import { completeSimple } from '@earendil-works/pi-ai';
import { createTriageLLMProvider } from '@lib/agent/triage-provider';
import {
  CallType,
  GPT5_6_LUNA_MODEL,
  HAIKU_TRIAGE_MODEL,
  Harness,
} from '@lib/constants';
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
  // Auth is a required argument: a call site that has none is a compile error,
  // not a provider that silently returns undefined and fails every scan closed.
  it('never reads gateway auth out of the environment', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://env.posthog.test';
    process.env.ANTHROPIC_AUTH_TOKEN = 'env-tok';
    complete.mockResolvedValue(reply('false_positive'));
    const provider = createTriageLLMProvider(AUTH, Harness.anthropic);
    return provider('verdict?').then(() => {
      expect(complete.mock.calls[0][0].baseUrl).toBe(AUTH.baseURL);
      expect(complete.mock.calls[0][2]?.apiKey).toBe(AUTH.authToken);
    });
  });

  it('triages a pi run on luna at the table effort, over openai-completions', async () => {
    complete.mockResolvedValue(reply('true_positive'));
    const provider = createTriageLLMProvider(AUTH, Harness.pi);

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
    const provider = createTriageLLMProvider(AUTH, Harness.anthropic);

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

  it('attributes its spend to the program that triggered the scan', async () => {
    // Triage fires per tool call; untagged it billed to no program at all.
    complete.mockResolvedValue(reply(''));
    const provider = createTriageLLMProvider(
      {
        ...AUTH,
        wizardMetadata: {
          program_id: 'posthog-integration',
          run_id: 'r1',
          call_type: CallType.yaraTriage,
        },
      },
      Harness.anthropic,
    );

    await provider('verdict?');

    expect(complete.mock.calls[0][0].headers).toMatchObject({
      'X-POSTHOG-PROPERTY-program_id': 'posthog-integration',
      'X-POSTHOG-PROPERTY-call_type': 'yara-triage',
    });
  });

  it('keeps only text blocks in the verdict', async () => {
    complete.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'weighing it' },
        { type: 'text', text: 'false_positive' },
      ],
    } as never);
    const provider = createTriageLLMProvider(AUTH, Harness.pi);
    await expect(provider('verdict?')).resolves.toBe('false_positive');
  });
});
