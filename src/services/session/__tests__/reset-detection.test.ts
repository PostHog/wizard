/** `SessionStore.resetDetection` forgets what detection found, with the analytics tags it set. */
import { Integration } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { FRAMEWORK_REGISTRY } from '@services/frameworks';
import { buildSession } from '../wizard-session';
import { SessionStore } from '../session-store';

vi.mock('@utils/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/analytics')>()),
  analytics: { setTag: vi.fn(), wizardCapture: vi.fn(), capture: vi.fn() },
}));

describe('SessionStore.resetDetection', () => {
  const detected = () => {
    const store = new SessionStore(buildSession({ installDir: '/project' }));
    store.setFrameworkConfig(
      Integration.nextjs,
      FRAMEWORK_REGISTRY[Integration.nextjs],
    );
    store.setDetectedFramework('Next.js');
    store.setPosthogSdkDetected(true);
    store.setFrameworkContext('posthogSdks', [{ key: 'posthog-node' }]);
    store.setUnsupportedVersion({
      current: 'x 1',
      minimum: 'x 2',
      docsUrl: 'https://example.com',
    });
    store.setDetectionComplete();
    vi.mocked(analytics.setTag).mockClear();
    return store;
  };

  it('clears the detection fields and leaves the rest', () => {
    const store = detected();

    store.resetDetection();

    expect(store.session).toMatchObject({
      installDir: '/project',
      integration: null,
      frameworkConfig: null,
      detectedFrameworkLabel: null,
      unsupportedVersion: null,
      posthogSdkDetected: false,
      detectionComplete: false,
      frameworkContext: {},
    });
  });

  it('clears the integration and detected framework tags', () => {
    const store = detected();

    store.resetDetection();

    expect(analytics.setTag).toHaveBeenCalledWith('integration', null);
    expect(analytics.setTag).toHaveBeenCalledWith('detected_framework', null);
  });

  it('notifies once', () => {
    const store = detected();
    const listener = vi.fn();
    store.subscribe(listener);

    store.batch(() => store.resetDetection());

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
