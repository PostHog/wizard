import {
  runWithProvisioningRetry,
  type AgentRunResult,
} from '@lib/agent/runner/shared/provisioning-retry';
import { AgentErrorType } from '@lib/agent/signals';

describe('runWithProvisioningRetry', () => {
  const provisioning: AgentRunResult = {
    error: AgentErrorType.PROVISIONING_ERROR,
    message: 'API Error: 403 INVALID_PAYMENT_INSTRUMENT',
  };
  const success: AgentRunResult = {};

  const noWait = () => Promise.resolve();

  it('does not retry when the first run succeeds', async () => {
    const runOnce = jest.fn<Promise<AgentRunResult>, []>(() =>
      Promise.resolve(success),
    );
    const onRetry = jest.fn();

    const result = await runWithProvisioningRetry(runOnce, onRetry, {
      wait: noWait,
    });

    expect(result).toEqual(success);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries on a provisioning error and returns the first non-provisioning result', async () => {
    const runOnce = jest
      .fn<Promise<AgentRunResult>, []>()
      .mockResolvedValueOnce(provisioning)
      .mockResolvedValueOnce(success);
    const onRetry = jest.fn();

    const result = await runWithProvisioningRetry(runOnce, onRetry, {
      delays: [10, 10],
      wait: noWait,
    });

    expect(result).toEqual(success);
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, total: 2, delayMs: 10 });
  });

  it('gives up after exhausting the backoff schedule and surfaces the provisioning error', async () => {
    const runOnce = jest.fn<Promise<AgentRunResult>, []>(() =>
      Promise.resolve(provisioning),
    );
    const onRetry = jest.fn();

    const result = await runWithProvisioningRetry(runOnce, onRetry, {
      delays: [10, 10],
      wait: noWait,
    });

    // First run + 2 retries = 3 attempts, all still failing.
    expect(result.error).toBe(AgentErrorType.PROVISIONING_ERROR);
    expect(runOnce).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('does not retry a different error type', async () => {
    const apiError: AgentRunResult = {
      error: AgentErrorType.API_ERROR,
      message: 'boom',
    };
    const runOnce = jest.fn<Promise<AgentRunResult>, []>(() =>
      Promise.resolve(apiError),
    );
    const onRetry = jest.fn();

    const result = await runWithProvisioningRetry(runOnce, onRetry, {
      wait: noWait,
    });

    expect(result).toEqual(apiError);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
