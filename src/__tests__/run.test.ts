import { runWizard } from '../run';
import { runAgentWizard } from '../lib/agent-runner';
import { analytics } from '../utils/analytics';
import { Integration } from '../lib/constants';

jest.mock('../lib/agent-runner');
jest.mock('../utils/analytics');
jest.mock('../utils/clack');

const mockRunAgentWizard = runAgentWizard as jest.MockedFunction<
  typeof runAgentWizard
>;
const mockAnalytics = analytics as jest.Mocked<typeof analytics>;

describe('runWizard error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockAnalytics.setTag = jest.fn();
    mockAnalytics.captureException = jest.fn();
    mockAnalytics.shutdown = jest.fn().mockResolvedValue(undefined);

    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should capture exception and shutdown analytics on wizard error', async () => {
    const testError = new Error('Wizard failed');
    const testArgs = {
      integration: Integration.nextjs,
      debug: true,
      forceInstall: false,
    };

    mockRunAgentWizard.mockRejectedValue(testError);

    await expect(runWizard(testArgs)).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(testError, {
      integration: Integration.nextjs,
      arguments: JSON.stringify(testArgs),
    });

    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('error');
  });

  it('should not call captureException when wizard succeeds', async () => {
    const testArgs = { integration: Integration.nextjs };

    mockRunAgentWizard.mockResolvedValue(undefined);

    await runWizard(testArgs);

    expect(mockAnalytics.captureException).not.toHaveBeenCalled();
    expect(mockAnalytics.shutdown).not.toHaveBeenCalled();
  });
});
