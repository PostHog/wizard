/* eslint-disable @typescript-eslint/require-await */
import {
  wizardAbort,
  WizardError,
  registerCleanup,
  clearCleanup,
  runCleanups,
  wizardCancel,
  registerCancelHook,
  clearCancel,
  installCancelSignals,
} from '@utils/wizard-abort';
import { analytics } from '@utils/analytics';
import { ErrorCodes } from '@shared/errors';
import { getUI } from '../ui';

vi.mock('@utils/analytics');
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

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {});
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
      integration: 'nextjs',
      error_type: 'MCP_MISSING',
    });
  });

  it('resolves the code from a coded WizardError when the caller passes none', async () => {
    // A mint refusal reaches wizardAbort as the error alone; its code must
    // still land on the captured exception.
    const error = new WizardError(
      'refused',
      { status: 403 },
      ErrorCodes.GatewayMintRefused,
    );

    await expect(wizardAbort({ error })).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {
      status: 403,
      error_code: ErrorCodes.GatewayMintRefused,
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

  it('captures an "error" ending that has no Error from its code and message', async () => {
    await expect(
      wizardAbort({
        message: 'Could not access MCP',
        code: ErrorCodes.AgentMcpMissing,
        status: 'error',
      }),
    ).rejects.toThrow('process.exit called');

    const [captured, properties] = mockAnalytics.captureException.mock
      .calls[0] as [WizardError, Record<string, unknown>];
    expect(captured).toBeInstanceOf(WizardError);
    expect(captured.message).toBe('Could not access MCP');
    expect(captured.code).toBe(ErrorCodes.AgentMcpMissing);
    expect(properties).toEqual({ error_code: ErrorCodes.AgentMcpMissing });
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('error');
  });

  it('shuts down as the explicit status even when an Error is provided', async () => {
    const error = new Error('stopped');

    await expect(wizardAbort({ error, status: 'cancelled' })).rejects.toThrow(
      'process.exit called',
    );

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {});
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
  });

  it('shuts down analytics as "cancelled" when no error is provided', async () => {
    await expect(wizardAbort({ message: 'Bad input' })).rejects.toThrow(
      'process.exit called',
    );

    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
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

describe('wizardCancel', () => {
  let exit: MockInstance<typeof process.exit>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearCleanup();
    clearCancel();
    mockAnalytics.shutdown = vi.fn().mockResolvedValue(undefined);
    exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs the cleanups, then the cancel hooks, then analytics, then exits 130', async () => {
    const order: string[] = [];
    registerCleanup(() => order.push('cleanup'));
    registerCancelHook(async () => {
      order.push('hook');
    });
    mockAnalytics.shutdown.mockImplementation(async (status) => {
      order.push(`analytics:${status}`);
    });
    exit.mockImplementation((() => order.push('exit')) as never);

    await wizardCancel('ctrl+c');

    expect(order).toEqual(['cleanup', 'hook', 'analytics:cancelled', 'exit']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(130);
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const)(
    'exits %s as 128 plus the signal number',
    async (signal, code) => {
      await wizardCancel(signal);
      expect(exit).toHaveBeenCalledExactlyOnceWith(code);
    },
  );

  it('exits at once on a second cancel while the first is settling', async () => {
    registerCancelHook(() => new Promise<void>(() => undefined));
    void wizardCancel('ctrl+c');
    await wizardCancel('ctrl+c');
    expect(exit).toHaveBeenCalledExactlyOnceWith(130);
  });

  it('exits when a cancel hook hangs or throws', async () => {
    vi.useFakeTimers();
    registerCancelHook(() => new Promise<void>(() => undefined));
    registerCancelHook(() => {
      throw new Error('stream gone');
    });
    const cancelled = wizardCancel('SIGTERM');
    await vi.advanceTimersByTimeAsync(2000);
    await cancelled;
    expect(exit).toHaveBeenCalledExactlyOnceWith(143);
  });

  it('skips a hook whose remover ran', async () => {
    const hook = vi.fn();
    registerCancelHook(hook)();
    await wizardCancel('ctrl+c');
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('installCancelSignals', () => {
  afterEach(() => vi.restoreAllMocks());

  it('routes SIGINT, SIGTERM and SIGHUP to one cancel, and removes them', () => {
    const on = vi.spyOn(process, 'on').mockReturnValue(process);
    const off = vi.spyOn(process, 'off').mockReturnValue(process);
    const remove = installCancelSignals();
    expect(on.mock.calls.map(([signal]) => signal)).toEqual([
      'SIGINT',
      'SIGTERM',
      'SIGHUP',
    ]);
    remove();
    expect(off.mock.calls).toEqual(on.mock.calls);
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
