import { WizardStore, ScreenId } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import {
  WizardReadiness,
  type WizardReadinessResult,
} from '@lib/health-checks/readiness';
import { ServiceHealthStatus } from '@lib/health-checks/types';
import { analytics } from '@utils/analytics';

vi.mock('../../../utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
  },
  sessionProperties: vi.fn(() => ({})),
}));

const skillsHealthy = { status: ServiceHealthStatus.Healthy } as const;
const gatewayOutage = (): WizardReadinessResult => ({
  decision: WizardReadiness.No,
  health: {
    skillsOrigin: skillsHealthy,
    llmGateway: { status: ServiceHealthStatus.Down, error: 'HTTP 503' },
  },
  reasons: ['LLM gateway: down'],
});

describe('gateway outage after pre-auth health checks', () => {
  it('waits for a fresh dismissal after the startup gate already resolved', async () => {
    const store = new WizardStore();
    const ui = new InkUI(store);
    store.completeSetup();
    store.setReadinessResult({
      decision: WizardReadiness.Yes,
      health: { skillsOrigin: skillsHealthy },
      reasons: [],
    });
    await store.getGate('health-check');
    store.dismissOutage();

    let continued = false;
    const waiting = ui.showBlockingOutage(gatewayOutage()).then(() => {
      continued = true;
    });
    await Promise.resolve();

    expect(store.session.outageDismissed).toBe(false);
    expect(store.currentScreen).toBe(ScreenId.HealthCheck);
    expect(continued).toBe(false);

    store.dismissOutage();
    await waiting;
    expect(continued).toBe(true);
    expect(store.currentScreen).not.toBe(ScreenId.HealthCheck);
  });

  it('retains dismissal for the same result and resets it for a new outage', () => {
    const store = new WizardStore();
    const first = gatewayOutage();
    store.setReadinessResult(first);
    store.dismissOutage();
    store.setReadinessResult(first);
    expect(store.session.outageDismissed).toBe(true);

    store.setReadinessResult(gatewayOutage());
    expect(store.session.outageDismissed).toBe(false);
  });

  it('records gateway failure without unrelated status-page claims', () => {
    vi.mocked(analytics.wizardCapture).mockClear();
    const store = new WizardStore();
    store.setReadinessResult(gatewayOutage());

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'health check blocked',
      {
        decision: 'confirmed-outage',
        blocking_keys: ['llmGateway'],
        retries_used: 0,
      },
    );
  });
});
