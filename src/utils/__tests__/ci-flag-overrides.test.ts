import {
  applyCiFlagOverrides,
  ciExcludedTaskTypes,
} from '@utils/ci-flag-overrides';

vi.mock('@utils/debug', () => ({
  logToFile: vi.fn(),
  debug: vi.fn(),
}));

const ENV_KEY = 'WIZARD_CI_FLAG_OVERRIDES';

describe('applyCiFlagOverrides', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  // Jest runs with NODE_ENV=test, so IS_PRODUCTION_BUILD is false and the
  // override path is live — the same shape a `build:ci` bundle has.
  describe('in CI builds', () => {
    it('returns the flags untouched when no override is set', () => {
      const flags = { 'wizard-orchestrator': 'false' };
      expect(applyCiFlagOverrides(flags)).toEqual({ flags, payloads: {} });
    });

    it('merges overrides over the fetched flags, stringifying values', () => {
      process.env[ENV_KEY] = JSON.stringify({
        'wizard-orchestrator': true,
        'wizard-next-v2': 'legacy',
      });
      expect(
        applyCiFlagOverrides({
          'wizard-orchestrator': 'false',
          'wizard-react-router': 'true',
        }).flags,
      ).toEqual({
        'wizard-orchestrator': 'true',
        'wizard-next-v2': 'legacy',
        'wizard-react-router': 'true',
      });
    });

    it('routes an object override to the payloads map and turns the flag on', () => {
      process.env[ENV_KEY] = JSON.stringify({
        'wizard-self-driving-use-pi-harness': {
          model: 'gpt-5-4',
          effort: 'low',
        },
      });
      expect(applyCiFlagOverrides({})).toEqual({
        flags: { 'wizard-self-driving-use-pi-harness': 'true' },
        payloads: {
          'wizard-self-driving-use-pi-harness': {
            model: 'gpt-5-4',
            effort: 'low',
          },
        },
      });
    });

    it('fails loudly on malformed JSON instead of testing live flags', () => {
      process.env[ENV_KEY] = 'wizard-orchestrator=true';
      expect(() => applyCiFlagOverrides({})).toThrow(/not valid JSON/);
    });
  });

  describe('in production builds', () => {
    it('is inert: overrides are ignored even when the env var is set', async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env[ENV_KEY] = JSON.stringify({ 'wizard-orchestrator': true });
      // Re-import fresh so the module re-reads NODE_ENV at load time (the
      // vitest equivalent of jest.isolateModules).
      vi.resetModules();
      const prod = (await import('@utils/ci-flag-overrides')) as {
        applyCiFlagOverrides: typeof applyCiFlagOverrides;
      };
      const result = prod.applyCiFlagOverrides({
        'wizard-orchestrator': 'false',
      });
      process.env.NODE_ENV = prevNodeEnv;
      expect(result).toEqual({
        flags: { 'wizard-orchestrator': 'false' },
        payloads: {},
      });
    });
  });
});

describe('ciExcludedTaskTypes', () => {
  afterEach(() => {
    delete process.env.WIZARD_CI_EXCLUDE_TASKS;
  });

  it('is empty when nothing is excluded', () => {
    expect(ciExcludedTaskTypes()).toEqual([]);
  });

  it('parses the comma-separated list, ignoring stray whitespace', () => {
    process.env.WIZARD_CI_EXCLUDE_TASKS = 'dashboard, report ,';
    expect(ciExcludedTaskTypes()).toEqual(['dashboard', 'report']);
  });

  it('is inert in production builds', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WIZARD_CI_EXCLUDE_TASKS = 'dashboard';
    // Re-import fresh so the module re-reads NODE_ENV at load time (the
    // vitest equivalent of jest.isolateModules).
    vi.resetModules();
    const prod = (await import('@utils/ci-flag-overrides')) as {
      ciExcludedTaskTypes: typeof ciExcludedTaskTypes;
    };
    const result = prod.ciExcludedTaskTypes();
    process.env.NODE_ENV = prevNodeEnv;
    expect(result).toEqual([]);
  });
});
