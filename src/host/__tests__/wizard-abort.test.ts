/* eslint-disable @typescript-eslint/require-await */
import {
  wizardAbort,
  WizardError,
  registerShutdown,
  clearCleanup,
  startHostExit,
  type AbortPresenter,
  type WizardAbortOptions,
} from '@host/wizard-abort';
import { registerCleanup, runCleanups } from '@utils/cleanup';
import { analytics } from '@utils/analytics';
import { ErrorCodes } from '@shared/errors';

vi.mock(import('@utils/analytics'));

const mockAnalytics = analytics as Mocked<typeof analytics>;

/** The UI the abort presenter shows its outro on; re-seeded before each test. */
let ui: {
  outroError: Mock;
  waitForOutroDismissed: Mock;
};
let present: AbortPresenter;

// vitest's restoreAllMocks() (afterEach) wipes mock return values (unlike
// jest, which only restores spyOn mocks), so re-seed the UI before each test.
const seedUI = () => {
  ui = {
    outroError: vi.fn(),
    waitForOutroDismissed: vi.fn().mockResolvedValue(undefined),
  };
  // A host passes its own presenter; here it forwards to the mock.
  present = async (outro) => {
    ui.outroError(outro);
    await ui.waitForOutroDismissed();
  };
};

/** Abort under a host, and resolve with the code the host gets. */
const ended = (options?: WizardAbortOptions): Promise<number> => {
  const exit = startHostExit();
  void wizardAbort(present, options);
  return exit.exited;
};

describe('wizardAbort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCleanup();
    seedUI();

    mockAnalytics.captureException = vi.fn();
    mockAnalytics.shutdown = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [{}, 'cancelled'],
    [{ error: new Error('failure') }, 'failed'],
    [{ code: ErrorCodes.InternalUnhandled, status: 'cancelled' }, 'cancelled'],
  ] as const)(
    'awaits stream shutdown before the host ends with outcome %s',
    async (options, outcome) => {
      let release!: () => void;
      const shutdown = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      registerShutdown(shutdown);
      let code: number | undefined;
      const exited = ended(options).then((c) => (code = c));
      expect(shutdown).toHaveBeenCalledWith(outcome);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(code).toBeUndefined();
      release();
      await exited;
      expect(code).toBe(1);
    },
  );

  it('calls analytics.shutdown, ui.outroError, and ends the host in order', async () => {
    const callOrder: string[] = [];
    mockAnalytics.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown');
    });
    ui.outroError.mockImplementation(() => {
      callOrder.push('outroError');
    });

    const code = await ended();
    callOrder.push('exit');

    expect(callOrder).toEqual(['shutdown', 'outroError', 'exit']);
    expect(code).toBe(1);
  });

  it('uses default message and exit code when called with no options', async () => {
    expect(await ended()).toBe(1);

    expect(ui.outroError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Wizard setup cancelled.' }),
    );
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
  });

  it('uses custom message and exit code', async () => {
    expect(await ended({ message: 'Custom failure', exitCode: 2 })).toBe(2);

    expect(ui.outroError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Custom failure' }),
    );
  });

  it('never settles after handing its code to the host', async () => {
    const exit = startHostExit();
    let settled = false;
    void wizardAbort(present).finally(() => (settled = true));
    expect(await exit.exited).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
  });

  it('throws when no host started an exit', async () => {
    vi.resetModules();
    const fresh = await import('@host/wizard-abort');
    await expect(fresh.wizardAbort(present)).rejects.toThrow(
      'wizardAbort ran outside a host',
    );
  });

  it('passes through structured outroData when provided', async () => {
    await ended({
      outroData: {
        kind: 'error' as never,
        message: 'Agent aborted',
        body: 'reason',
        docsUrl: 'https://posthog.com/docs',
      },
    });

    expect(ui.outroError).toHaveBeenCalledWith({
      kind: 'error',
      message: 'Agent aborted',
      body: 'reason',
      docsUrl: 'https://posthog.com/docs',
    });
  });

  it('captures error in analytics and shuts down as error when error is provided', async () => {
    const error = new Error('something broke');

    await ended({ error });

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {});
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('error');
  });

  it('does not capture error when no error is provided', async () => {
    await ended();

    expect(mockAnalytics.captureException).not.toHaveBeenCalled();
  });

  it('includes WizardError context in analytics capture', async () => {
    const error = new WizardError('MCP missing', {
      integration: 'nextjs',
      error_type: 'MCP_MISSING',
    });

    await ended({ error });

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

    await ended({ error });

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
    ui.outroError.mockImplementation(() => {
      callOrder.push('outroError');
    });

    await ended();

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

    expect(await ended()).toBe(1);

    expect(mockAnalytics.shutdown).toHaveBeenCalled();
    expect(ui.outroError).toHaveBeenCalled();
  });

  it('captures an "error" ending that has no Error from its code and message', async () => {
    await ended({
      message: 'Could not access MCP',
      code: ErrorCodes.AgentMcpMissing,
      status: 'error',
    });

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

    await ended({ error, status: 'cancelled' });

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {});
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
  });

  it('shuts down analytics as "cancelled" when no error is provided', async () => {
    await ended({ message: 'Bad input' });

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
