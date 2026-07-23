import { createTriageLLMProvider } from './triage-provider';

vi.mock('@utils/debug', () => ({
  logToFile: vi.fn(),
}));

// Mock axios so the returned provider doesn't hit the network; we never call
// the returned function in these tests so the mock body is inert.
vi.mock('axios');

describe('createTriageLLMProvider', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('returns a provider function when explicit auth is given', () => {
    const provider = createTriageLLMProvider({
      baseURL: 'https://gateway.example.com',
      authToken: 'tok_abc123',
    });

    expect(provider).toBeTruthy();
    expect(typeof provider).toBe('function');
  });

  it('returns undefined when no auth arg is passed (fail-closed)', () => {
    const provider = createTriageLLMProvider();

    expect(provider).toBeUndefined();
  });

  it('returns undefined when auth arg is empty object (env is no longer consulted)', () => {
    // Stub the env vars that the old code used to read — the current code
    // must NOT fall back to them.
    process.env.ANTHROPIC_BASE_URL = 'https://stale-env.example.com';
    process.env.ANTHROPIC_AUTH_TOKEN = 'tok_stale_env';

    // Cast through any to test the runtime env-is-no-longer-read path
    // (the call at L52-53 used to fall back to process.env when auth.baseURL
    // was undefined — we're proving that fallback is gone).
    const provider = createTriageLLMProvider({} as any);

    expect(provider).toBeUndefined();
  });
});
