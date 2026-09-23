import { runMcpPromptViaSdk } from '@agent';
import { createPosthogInferenceAuthProvider } from '@programs';
import { HostResolution } from '@shared/posthog/host-resolution';
import type { Credentials } from '@shared/posthog/api';
import { WizardStore } from '@tui/state/store';
import { createMcpSuggestedPromptsServices } from '../mcp-suggested-prompts-services';

vi.mock('@agent', async (original) => ({
  ...(await original<typeof import('@agent')>()),
  runMcpPromptViaSdk: vi.fn(),
}));
vi.mock('@programs', async (original) => ({
  ...(await original<typeof import('@programs')>()),
  createPosthogInferenceAuthProvider: vi.fn(),
}));

const credentials: Credentials = {
  accessToken: 'phx_test',
  projectApiKey: 'phc_test',
  projectId: 42,
  host: HostResolution.fromRegion('us'),
};

async function consumePrompt(store: WizardStore): Promise<void> {
  const services = createMcpSuggestedPromptsServices(store);
  for await (const chunk of services.runPromptStreaming({
    prompt: 'Show recent events',
    credentials,
    signal: new AbortController().signal,
  })) {
    void chunk;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runMcpPromptViaSdk).mockImplementation(async function* () {
    await Promise.resolve();
    yield* [];
  });
});

it('uses the fixed provider from the TUI store for MCP prompt inference', async () => {
  const store = new WizardStore('mcp-tutorial');
  const fixed = { resolve: vi.fn() };
  store.setInferenceAuth(fixed);

  await consumePrompt(store);

  expect(vi.mocked(runMcpPromptViaSdk).mock.calls[0][0].inferenceAuth).toBe(
    fixed,
  );
  expect(createPosthogInferenceAuthProvider).not.toHaveBeenCalled();
});

it('creates the ordinary PostHog provider when the store has none', async () => {
  const store = new WizardStore('mcp-tutorial');
  const fallback = { resolve: vi.fn() };
  vi.mocked(createPosthogInferenceAuthProvider).mockReturnValue(fallback);

  await consumePrompt(store);

  expect(createPosthogInferenceAuthProvider).toHaveBeenCalledWith(
    credentials,
    store.analyticsProgramId,
  );
  expect(vi.mocked(runMcpPromptViaSdk).mock.calls[0][0].inferenceAuth).toBe(
    fallback,
  );
});
