/** `runReadyHooks` runs the codebase scan, then onReady, before it marks detection complete. */
import { findProgramConfig, scanCodebaseFor } from '@programs';
import { Program, WizardStore } from '@tui/store';

vi.mock('@utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));
vi.mock('@programs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@programs')>()),
  scanCodebaseFor: vi.fn().mockResolvedValue(undefined),
}));

describe('WizardStore.runReadyHooks', () => {
  it('scans the codebase for the active program before its onReady', async () => {
    const config = findProgramConfig(Program.Metrics);
    if (!config) throw new Error('Metrics config missing');
    const calls: string[] = [];
    vi.mocked(scanCodebaseFor).mockImplementation(() => {
      calls.push('scan');
      return Promise.resolve();
    });
    const original = config.onReady;
    config.onReady = () => {
      calls.push('onReady');
      return Promise.resolve();
    };
    try {
      const store = new WizardStore(Program.Metrics);
      await store.runReadyHooks();

      expect(calls).toEqual(['scan', 'onReady']);
      expect(scanCodebaseFor).toHaveBeenCalledWith(config, expect.anything());
      expect(store.session.detectionComplete).toBe(true);
    } finally {
      config.onReady = original;
    }
  });
});
