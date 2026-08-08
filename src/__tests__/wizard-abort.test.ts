/* eslint-disable @typescript-eslint/require-await */
import {
  wizardAbort,
  WizardError,
  abortFingerprint,
  registerCleanup,
  clearCleanup,
  runCleanups,
} from '@utils/wizard-abort';
import { analytics } from '@utils/analytics';
import { getUI } from '../ui';

vi.mock('../utils/analytics');
vi.mock('../ui', () => ({
  getUI: vi.fn().mockReturnValue({
    outroError: vi.fn(),
    waitForOutroDismissed: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockAnalytics = analytics as Mocked<typeof analytics>;

// vitest's restoreAllMocks() (afterEach) wipes the getUI() factory mock's
// return value (unlike jest, which only restores spyOn mocks), so re-seed it
// before each test.
const seedGetUI = () => {
  (getUI as Mock).mockReturnValue({
    outroError: vi.fn(),
    waitForOutroDismissed: vi.fn().mockResolvedValue(undefined),
  });
};

describe('wizardAbort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCleanup();
    seedGetUI();

    mockAnalytics.captureException = vi.fn();
    mockAnalytics.shutdown = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls analytics.shutdown, getUI().outroError, and process.exit in order', async () => {
    const callOrder: string[] = [];
    mockAnalytics.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown');
    });
    (getUI().outroError as unknown as Mock).mockImplementation(() => {
      callOrder.push('outroError');
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(callOrder).toEqual(['shutdown', 'outroError']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('uses default message and exit code when called with no options', async () => {
    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(getUI().outroError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Wizard setup cancelled.' }),
    );
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('uses custom message and exit code', async () => {
    await expect(
      wizardAbort({ message: 'Custom failure', exitCode: 2 }),
    ).rejects.toThrow('process.exit called');

    expect(getUI().outroError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Custom failure' }),
    );
    expect(process.exit).toHaveBeenCalledWith(2);
  });

  it('passes through structured outroData when provided', async () => {
    await expect(
      wizardAbort({
        outroData: {
          kind: 'error' as never,
          message: 'Agent aborted',
          body: 'reason',
          docsUrl: 'https://posthog.com/docs',
        },
      }),
    ).rejects.toThrow('process.exit called');

    expect(getUI().outroError).toHaveBeenCalledWith({
      kind: 'error',
      message: 'Agent aborted',
      body: 'reason',
      docsUrl: 'https://posthog.com/docs',
    });
  });

  it('captures error in analytics and shuts down as error when error is provided', async () => {
    const error = new Error('something broke');

    await expect(wizardAbort({ error })).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {
      $exception_fingerprint: 'wizard_abort_something_broke',
    });
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('error');
  });

  it('does not capture error when no error is provided', async () => {
    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).not.toHaveBeenCalled();
  });

  it('includes WizardError context in analytics capture', async () => {
    const error = new WizardError('MCP missing', {
      integration: 'nextjs',
      error_type: 'MCP_MISSING',
    });

    await expect(wizardAbort({ error })).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {
      $exception_fingerprint: 'wizard_abort_mcp_missing',
      integration: 'nextjs',
      error_type: 'MCP_MISSING',
    });
  });

  it('lets a WizardError context override the default fingerprint', async () => {
    const error = new WizardError('OAuth error: timeout', {
      $exception_fingerprint: 'wizard_oauth_timeout',
    });

    await expect(wizardAbort({ error })).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {
      $exception_fingerprint: 'wizard_oauth_timeout',
    });
  });

  it('runs registered cleanup functions before analytics and display', async () => {
    const callOrder: string[] = [];

    registerCleanup(() => callOrder.push('cleanup1'));
    registerCleanup(() => callOrder.push('cleanup2'));
    mockAnalytics.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown');
    });
    (getUI().outroError as unknown as Mock).mockImplementation(() => {
      callOrder.push('outroError');
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(callOrder).toEqual([
      'cleanup1',
      'cleanup2',
      'shutdown',
      'outroError',
    ]);
  });

  it('does not block exit when a cleanup function throws', async () => {
    registerCleanup(() => {
      throw new Error('cleanup failed');
    });
    registerCleanup(() => {
      /* this should still run */
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(mockAnalytics.shutdown).toHaveBeenCalled();
    expect(getUI().outroError).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('shuts down analytics as "cancelled" when no error is provided', async () => {
    await expect(wizardAbort({ message: 'Bad input' })).rejects.toThrow(
      'process.exit called',
    );

    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
  });
});

describe('abortFingerprint', () => {
  it('is identical for the same cause raised from different install paths', () => {
    const fromNpx = new WizardError(
      'orchestrator drain ended with failed tasks',
    );
    fromNpx.stack =
      'WizardError\n    at /home/u/.npm/_npx/2f0a/node_modules/@posthog/wizard/dist/index.js:1:1';
    const fromPnpmDlx = new WizardError(
      'orchestrator drain ended with failed tasks',
    );
    fromPnpmDlx.stack =
      'WizardError\n    at /root/.cache/pnpm/dlx/9b7c1f/node_modules/@posthog/wizard/dist/index.js:1:1';

    expect(abortFingerprint(fromNpx)).toBe(abortFingerprint(fromPnpmDlx));
    expect(abortFingerprint(fromNpx)).toBe(
      'wizard_abort_orchestrator_drain_ended_with_failed_tasks',
    );
  });

  it('separates the failed-tasks guard from the never-ran guard', () => {
    expect(
      abortFingerprint(
        new WizardError('orchestrator drain ended with failed tasks'),
      ),
    ).not.toBe(
      abortFingerprint(
        new WizardError('orchestrator drain ended with tasks that never ran'),
      ),
    );
  });

  it('truncates long messages so a shared cause stays one group', () => {
    const suffix =
      'API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true`';
    const once = new WizardError(`API error: ${suffix}`);
    const twice = new WizardError(`API error: ${suffix}\n${suffix}`);

    expect(abortFingerprint(once)).toBe(abortFingerprint(twice));
    // Prefix + 80 chars of slug, and never a trailing separator.
    expect(abortFingerprint(once).length).toBeLessThanOrEqual(
      'wizard_abort_'.length + 80,
    );
    expect(abortFingerprint(once)).not.toMatch(/_$/);
  });

  it('falls back to the error name when there is no message', () => {
    expect(abortFingerprint(new TypeError(''))).toBe('wizard_abort_typeerror');
  });
});

describe('runCleanups', () => {
  beforeEach(() => {
    clearCleanup();
  });

  it('runs all registered cleanup functions', () => {
    const calls: string[] = [];
    registerCleanup(() => calls.push('a'));
    registerCleanup(() => calls.push('b'));
    runCleanups();
    expect(calls).toEqual(['a', 'b']);
  });

  it('drains the array so a second call is a no-op', () => {
    const calls: string[] = [];
    registerCleanup(() => calls.push('a'));
    runCleanups();
    runCleanups();
    expect(calls).toEqual(['a']);
  });

  it('continues past a throwing cleanup and runs remaining fns', () => {
    const calls: string[] = [];
    registerCleanup(() => {
      throw new Error('boom');
    });
    registerCleanup(() => calls.push('after'));
    runCleanups();
    expect(calls).toEqual(['after']);
  });
});

describe('abort() delegates to wizardAbort()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCleanup();
    seedGetUI();

    mockAnalytics.captureException = vi.fn();
    mockAnalytics.shutdown = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('abort() calls wizardAbort with message and exitCode', async () => {
    const { abort } = await import('@utils/setup-utils');

    await expect(abort('Test abort', 3)).rejects.toThrow('process.exit called');

    expect(getUI().outroError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Test abort' }),
    );
    expect(process.exit).toHaveBeenCalledWith(3);
  });

  it('abort() uses defaults when called with no args', async () => {
    const { abort } = await import('@utils/setup-utils');

    await expect(abort()).rejects.toThrow('process.exit called');

    expect(getUI().outroError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Wizard setup cancelled.' }),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
