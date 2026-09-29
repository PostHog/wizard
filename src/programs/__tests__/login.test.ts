vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    identifyUser: vi.fn(),
    setGroups: vi.fn(),
  } as never,
  groupsFromUser: vi.fn(() => ({})),
}));

import type { ApiUser } from '@shared/api';
import { HostResolution } from '@shared/host-resolution';
import { analytics } from '@utils/analytics';
import { logIn } from '../login';
import { SessionStore } from '../session/session-store';
import { buildSession } from '../session/wizard-session';

const apiUser = { role_at_organization: 'engineering' } as ApiUser;
const login = {
  posthog: {
    accessToken: 'phx_test',
    projectApiKey: 'phc_test',
    projectId: 7,
    host: HostResolution.fromRegion('us'),
  },
  project: null,
  apiUser,
};
const never = new AbortController().signal;

describe('logIn', () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a provider's login once, with no auth-complete event of its own", async () => {
    const store = new SessionStore(buildSession({ installDir: '/project' }));
    const resolve = vi.fn(() => Promise.resolve(login));
    await logIn('metrics', store, { provider: { resolve }, signal: never });
    expect(store.session.credentials).toEqual(login.posthog);
    expect(store.session.apiUser).toBe(apiUser);
    expect(store.session.roleAtOrganization).toBe('engineering');
    // The OAuth login reports `auth complete`; a key login is not a user signing in.
    expect(analytics.wizardCapture).not.toHaveBeenCalled();

    // A second call in the same store reuses the login.
    await logIn('metrics', store, { provider: { resolve }, signal: never });
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("puts a CI run's pre-issued gateway token on the login", async () => {
    const store = new SessionStore(buildSession({ installDir: '/project' }));
    const gateway = { token: 'gw_test', url: 'http://localhost:8080' };
    store.update({ ciGateway: gateway });
    const result = await logIn('metrics', store, {
      credentials: login,
      signal: never,
    });
    expect(result.posthog.gateway).toEqual(gateway);
    expect(store.session.credentials?.gateway).toEqual(gateway);
  });
});
