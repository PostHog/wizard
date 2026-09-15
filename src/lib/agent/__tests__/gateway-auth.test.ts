import { requireGatewayAuth } from '@lib/agent/gateway-auth';
import {
  gatewayAuth,
  GatewayMintFailed,
  GatewayMintRefused,
  type GatewayAuth,
} from '@lib/gateway-session';
import type { HostResolution } from '@lib/host-resolution';
import { setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { InkUI } from '@ui/tui/ink-ui';
import { ScreenId, WizardStore } from '@ui/tui/store';
import { wizardAbort } from '@utils/wizard-abort';

vi.mock('@lib/gateway-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/gateway-session')>()),
  gatewayAuth: vi.fn(),
}));

vi.mock('@utils/wizard-abort', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/wizard-abort')>()),
  wizardAbort: vi.fn(),
}));

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
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
    setUI(new LoggingUI());
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
  ])('aborts a headless run with the coded failure: $name', async (error) => {
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

  it('parks a TUI run on the mint-failure screen instead of aborting', async () => {
    const store = new WizardStore();
    setUI(new InkUI(store));
    const error = new GatewayMintRefused(429, 'Weekly limit reached');
    vi.mocked(gatewayAuth).mockRejectedValue(error);

    const settled = vi.fn();
    void Promise.allSettled([
      requireGatewayAuth(host, 'pha_test', 'integration'),
      requireGatewayAuth(host, 'pha_test', 'integration'),
    ]).then(settled);
    await vi.waitFor(() =>
      expect(store.currentScreen).toBe(ScreenId.MintFailure),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(settled).not.toHaveBeenCalled();
    expect(wizardAbort).not.toHaveBeenCalled();
    expect(store.session.outroData?.errorCode).toBe(error.code);
    expect(store.session.outroData?.message).toBe(error.message);
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
