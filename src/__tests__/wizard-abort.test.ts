/* eslint-disable @typescript-eslint/require-await */
import {
  wizardAbort,
  WizardError,
  registerCleanup,
  clearCleanup,
} from '../utils/wizard-abort';
import { analytics } from '../utils/analytics';

jest.mock('../utils/analytics');
jest.mock('../ui', () => ({
  getUI: jest.fn().mockReturnValue({
    outro: jest.fn(),
  }),
}));

const mockAnalytics = analytics as jest.Mocked<typeof analytics>;
const { getUI } = jest.requireMock('../ui');

describe('wizardAbort', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCleanup();

    mockAnalytics.captureException = jest.fn();
    mockAnalytics.shutdown = jest.fn().mockResolvedValue(undefined);

    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls analytics.shutdown, getUI().outro, and process.exit in order', async () => {
    const callOrder: string[] = [];
    mockAnalytics.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown');
    });
    getUI().outro.mockImplementation(() => {
      callOrder.push('outro');
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(callOrder).toEqual(['shutdown', 'outro']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('uses default message and exit code when called with no options', async () => {
    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(getUI().outro).toHaveBeenCalledWith('Wizard setup cancelled.');
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('uses custom message and exit code', async () => {
    await expect(
      wizardAbort({ message: 'Custom failure', exitCode: 2 }),
    ).rejects.toThrow('process.exit called');

    expect(getUI().outro).toHaveBeenCalledWith('Custom failure');
    expect(process.exit).toHaveBeenCalledWith(2);
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

  it('runs registered cleanup functions before analytics and display', async () => {
    const callOrder: string[] = [];

    registerCleanup(() => callOrder.push('cleanup1'));
    registerCleanup(() => callOrder.push('cleanup2'));
    mockAnalytics.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown');
    });
    getUI().outro.mockImplementation(() => {
      callOrder.push('outro');
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(callOrder).toEqual(['cleanup1', 'cleanup2', 'shutdown', 'outro']);
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
    expect(getUI().outro).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('shuts down analytics as "cancelled" when no error is provided', async () => {
    await expect(wizardAbort({ message: 'Bad input' })).rejects.toThrow(
      'process.exit called',
    );

    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
  });
});

describe('abort() delegates to wizardAbort()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCleanup();

    mockAnalytics.captureException = jest.fn();
    mockAnalytics.shutdown = jest.fn().mockResolvedValue(undefined);

    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('abort() calls wizardAbort with message and exitCode', async () => {
    const { abort } = await import('../utils/setup-utils.js');

    await expect(abort('Test abort', 3)).rejects.toThrow('process.exit called');

    expect(getUI().outro).toHaveBeenCalledWith('Test abort');
    expect(process.exit).toHaveBeenCalledWith(3);
  });

  it('abort() uses defaults when called with no args', async () => {
    const { abort } = await import('../utils/setup-utils.js');

    await expect(abort()).rejects.toThrow('process.exit called');

    expect(getUI().outro).toHaveBeenCalledWith('Wizard setup cancelled.');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
