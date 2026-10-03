import { authenticate } from '@programs/authenticate';
import { buildSession } from '@programs/session/wizard-session';
import { rotateCredentials } from '@programs/credentials';
import { getUI } from '@ui';
import { currentCredentials, resetOAuthSession } from '@shared/oauth-session';
import type { HostResolution } from '@shared/host-resolution';
import type { Mock } from 'vitest';

vi.mock('@tui/auth/project-data', () => ({
  getOrAskForProjectData: vi.fn(() =>
    Promise.resolve({
      projectApiKey: 'phc_x',
      host: { apiHost: 'https://us.i.posthog.com' } as HostResolution,
      accessToken: 'pha_old',
      refreshToken: 'phr_old',
      // Already expired, as it is when a screen waits past the 1-hour lifetime.
      expiresAt: Date.now() - 1000,
      projectId: 42,
      roleAtOrganization: null,
      user: null,
      project: null,
      missingScopes: [],
    }),
  ),
}));
vi.mock('@programs/credentials', () => ({
  rotateCredentials: vi.fn((held: object) =>
    Promise.resolve({ ...held, accessToken: 'pha_new' }),
  ),
}));
vi.mock('@ui', () => {
  const ui = {
    setCredentials: vi.fn(),
    setAccessToken: vi.fn(),
    setRoleAtOrganization: vi.fn(),
    setApiUser: vi.fn(),
  };
  return { getUI: () => ui };
});
vi.mock('@utils/analytics', () => ({
  analytics: { identifyUser: vi.fn(), setGroups: vi.fn() },
  groupsFromUser: vi.fn(() => ({})),
}));

describe('authenticate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOAuthSession();
  });

  // Screens before the first agent run, like the Self-driving GitHub gate, can
  // only refresh their token if the login owns the refresh from the start.
  it('hands the login to the OAuth session so a pre-run screen can refresh it', async () => {
    const session = buildSession({});
    await authenticate(session, 'self-driving');

    const held = session.credentials;
    if (!held) throw new Error('authenticate did not set credentials');
    const fresh = await currentCredentials(held);

    expect(rotateCredentials as Mock).toHaveBeenCalledTimes(1);
    expect(fresh.accessToken).toBe('pha_new');
    expect(getUI().setAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'pha_new' }),
    );
  });
});
