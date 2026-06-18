import {
  applyCiFlagOverrides,
  ciExcludedTaskTypes,
} from '@utils/ci-flag-overrides';

jest.mock('@utils/debug', () => ({
  logToFile: jest.fn(),
  debug: jest.fn(),
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
      expect(applyCiFlagOverrides(flags)).toEqual(flags);
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
        }),
      ).toEqual({
        'wizard-orchestrator': 'true',
        'wizard-next-v2': 'legacy',
        'wizard-react-router': 'true',
      });
    });

    it('fails loudly on malformed JSON instead of testing live flags', () => {
      process.env[ENV_KEY] = 'wizard-orchestrator=true';
      expect(() => applyCiFlagOverrides({})).toThrow(/not valid JSON/);
    });
  });

  describe('in production builds', () => {
    it('is inert: overrides are ignored even when the env var is set', () => {
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env[ENV_KEY] = JSON.stringify({ 'wizard-orchestrator': true });
      let result: Record<string, string> | undefined;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const prod = require('@utils/ci-flag-overrides') as {
          applyCiFlagOverrides: typeof applyCiFlagOverrides;
        };
        result = prod.applyCiFlagOverrides({ 'wizard-orchestrator': 'false' });
      });
      process.env.NODE_ENV = prevNodeEnv;
      expect(result).toEqual({ 'wizard-orchestrator': 'false' });
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

  it('is inert in production builds', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WIZARD_CI_EXCLUDE_TASKS = 'dashboard';
    let result: readonly string[] | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const prod = require('@utils/ci-flag-overrides') as {
        ciExcludedTaskTypes: typeof ciExcludedTaskTypes;
      };
      result = prod.ciExcludedTaskTypes();
    });
    process.env.NODE_ENV = prevNodeEnv;
    expect(result).toEqual([]);
  });
});
