import { requireGatewayAuth } from '@lib/agent/gateway-auth';
import {
  gatewayAuth,
  GatewayMintFailed,
  GatewayMintRefused,
  type GatewayAuth,
} from '@lib/gateway-session';
import type { HostResolution } from '@lib/host-resolution';
import { wizardAbort } from '@utils/wizard-abort';

vi.mock('@lib/gateway-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/gateway-session')>()),
  gatewayAuth: vi.fn(),
}));

vi.mock('@utils/wizard-abort', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/wizard-abort')>()),
  wizardAbort: vi.fn(),
}));

const host = { apiHost: 'https://us.posthog.com' } as HostResolution;
const auth: GatewayAuth = {
  gatewayUrl: 'https://gateway.us.posthog.com',
  token: 'phe_test',
  refreshAtMs: Date.now() + 3600_000,
};

describe('requireGatewayAuth', () => {
  beforeEach(() => {
    vi.mocked(gatewayAuth).mockReset();
    vi.mocked(wizardAbort).mockReset();
  });

  it('returns a usable credential unchanged', async () => {
    vi.mocked(gatewayAuth).mockResolvedValue(auth);

    await expect(
      requireGatewayAuth(host, 'pha_test', 'integration'),
    ).resolves.toBe(auth);
    expect(gatewayAuth).toHaveBeenCalledWith(host, 'pha_test', 'integration');
    expect(wizardAbort).not.toHaveBeenCalled();
  });

  it.each([
    new GatewayMintRefused(403, 'Access denied', 'blocked'),
    new GatewayMintFailed('Mint unavailable'),
  ])('preserves the coded failure in the fatal outro: $name', async (error) => {
    const exit = new Error('Wizard exited');
    vi.mocked(gatewayAuth).mockRejectedValue(error);
    vi.mocked(wizardAbort).mockRejectedValue(exit);

    await expect(
      requireGatewayAuth(host, 'pha_test', 'integration'),
    ).rejects.toBe(exit);
    expect(wizardAbort).toHaveBeenCalledExactlyOnceWith({
      message: error.message,
      error,
    });
  });

  it('parks concurrent callers behind one fatal outro until it exits', async () => {
    const error = new GatewayMintRefused(429, 'Daily limit reached');
    const exit = new Error('Wizard exited');
    let exitAbort: (error: Error) => void;
    const abort = new Promise<never>((_, reject) => {
      exitAbort = reject;
    });
    vi.mocked(gatewayAuth).mockRejectedValue(error);
    vi.mocked(wizardAbort).mockReturnValue(abort);

    const calls = [
      requireGatewayAuth(host, 'pha_test', 'integration'),
      requireGatewayAuth(host, 'pha_test', 'integration'),
    ];
    const settled = vi.fn();
    const results = Promise.allSettled(calls).then(settled);
    await vi.waitFor(() => expect(wizardAbort).toHaveBeenCalledTimes(1));
    expect(settled).not.toHaveBeenCalled();

    exitAbort!(exit);
    await results;
    expect(settled).toHaveBeenCalledExactlyOnceWith([
      { status: 'rejected', reason: exit },
      { status: 'rejected', reason: exit },
    ]);
  });

  it('also aborts a failed renewal after an earlier mint succeeded', async () => {
    const error = new GatewayMintFailed('Renewal unavailable');
    const exit = new Error('Wizard exited');
    vi.mocked(gatewayAuth)
      .mockResolvedValueOnce(auth)
      .mockRejectedValueOnce(error);
    vi.mocked(wizardAbort).mockRejectedValue(exit);

    await requireGatewayAuth(host, 'pha_test', 'integration');
    await expect(
      requireGatewayAuth(host, 'pha_test', 'integration'),
    ).rejects.toBe(exit);
    expect(wizardAbort).toHaveBeenCalledExactlyOnceWith({
      message: error.message,
      error,
    });
  });

  it('leaves unrelated errors to the existing caller handling', async () => {
    const error = new Error('Unexpected failure');
    vi.mocked(gatewayAuth).mockRejectedValue(error);

    await expect(
      requireGatewayAuth(host, 'pha_test', 'integration'),
    ).rejects.toBe(error);
    expect(wizardAbort).not.toHaveBeenCalled();
  });
});
