import { ApiError } from '../../lib/api';
import { handleProjectDataAuthError } from '../setup-utils';
import { analytics } from '../analytics';

jest.mock('../analytics');
jest.mock('../../ui', () => ({
  getUI: jest.fn().mockReturnValue({
    showAuthError: jest.fn(),
    outroError: jest.fn(),
    waitForOutroDismissed: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('../debug', () => ({
  getLogFilePath: jest.fn().mockReturnValue('/tmp/wizard.log'),
  debug: jest.fn(),
  logToFile: jest.fn(),
}));

const mockAnalytics = analytics as jest.Mocked<typeof analytics>;
const { getUI } = jest.requireMock('../../ui');

describe('handleProjectDataAuthError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/require-await
    mockAnalytics.shutdown = jest.fn().mockImplementation(async () => {});
    mockAnalytics.captureException = jest.fn();
    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes a 401 ApiError through showAuthError and aborts', async () => {
    const err = new ApiError('Authentication failed', 401, '/api/projects/1/');

    await expect(handleProjectDataAuthError(err)).rejects.toThrow(
      'process.exit called',
    );

    expect(getUI().showAuthError).toHaveBeenCalledWith({
      hasSettingsConflict: false,
      logFilePath: '/tmp/wizard.log',
    });
    expect(mockAnalytics.captureException).toHaveBeenCalledWith(err, {});
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('returns without action for non-401 ApiError', async () => {
    const err = new ApiError('Not found', 404, '/api/projects/1/');

    await expect(handleProjectDataAuthError(err)).resolves.toBeUndefined();

    expect(getUI().showAuthError).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('returns without action for non-ApiError errors', async () => {
    await expect(
      handleProjectDataAuthError(new Error('boom')),
    ).resolves.toBeUndefined();

    expect(getUI().showAuthError).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });
});
