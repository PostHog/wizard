import { WizardStore, Program } from '@tui/store';
import { buildSession } from '@programs';
import { chooseProvisionAccount, setIntegrate } from '../store-actions';

vi.mock(import('@utils/analytics.js'), () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
  } as never,
  sessionProperties: vi.fn(() => ({})),
}));

function createStore(): WizardStore {
  return new WizardStore(Program.SelfDriving);
}

describe('setIntegrate (self-driving integration check)', () => {
  it('records "yes, already integrated" as integrate=false', () => {
    const store = createStore();
    store.session = buildSession({});
    setIntegrate(store, false);
    expect(store.integrate).toBe(false);
  });

  it('--integrate pre-resolves the decision to true', () => {
    const store = createStore();
    store.launch(buildSession({}), { integrate: true });
    expect(store.integrate).toBe(true);
  });
});

describe('chooseProvisionAccount (self-driving "no account" branch)', () => {
  it('flips signup and records email + region, and integrates', () => {
    const store = createStore();
    store.session = buildSession({});

    chooseProvisionAccount(store, 'dev@example.com', 'eu');

    expect(store.session.signup).toBe(true);
    expect(store.session.email).toBe('dev@example.com');
    expect(store.session.region).toBe('eu');
    expect(store.integrate).toBe(true);
  });
});
