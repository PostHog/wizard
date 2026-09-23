import {
  authenticate,
  bindAuthHost,
  type AuthHost,
  type AuthSession,
} from '../authenticate';
import { getOrAskForProjectData } from '@programs/project-data';
import { HostResolution } from '@shared/host-resolution';
import type { ApiUser } from '@shared/api';

vi.mock('@programs/project-data', () => ({ getOrAskForProjectData: vi.fn() }));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({
  analytics: { identifyUser: vi.fn(), setGroups: vi.fn() },
  groupsFromUser: vi.fn().mockReturnValue({}),
}));
vi.mock('@ui', () => ({
  getUI: () => {
    throw new Error('authentication must use the supplied projection');
  },
}));

function hostWithout(): Omit<
  AuthHost,
  'setCredentials' | 'setRoleAtOrganization' | 'setApiUser'
> {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
    spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
    setLoginUrl: vi.fn(),
    setAuthorizeUrl: vi.fn(),
    waitForManualAuthCode: vi.fn(),
    showSessionTimeout: vi.fn(),
    showPortConflict: vi.fn(),
    abort: vi.fn(),
  };
}

it('binds a class-based UI into a host that keeps its receiver', async () => {
  class RecordingUi {
    lines: string[] = [];
    log = {
      info: (m: string) => this.lines.push(`info ${m}`),
      warn: (m: string) => this.lines.push(`warn ${m}`),
      error: (m: string) => this.lines.push(`error ${m}`),
      success: (m: string) => this.lines.push(`success ${m}`),
    };
    spinner() {
      this.lines.push('spinner');
      return { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
    }
    setLoginUrl(url: string | null) {
      this.lines.push(`login ${url}`);
    }
    setAuthorizeUrl(url: string | null) {
      this.lines.push(`authorize ${url}`);
    }
    waitForManualAuthCode() {
      return Promise.resolve(`code for ${this.lines.length}`);
    }
    showSessionTimeout() {
      this.lines.push('timeout');
    }
    showPortConflict() {
      this.lines.push('port');
      return Promise.resolve();
    }
    setCredentials() {
      this.lines.push('credentials');
    }
    setRoleAtOrganization(role: string | null) {
      this.lines.push(`role ${role}`);
    }
    setApiUser() {
      this.lines.push('user');
    }
  }
  const ui = new RecordingUi();
  const abort = vi.fn();

  const host = bindAuthHost(ui, abort);
  host.setLoginUrl('http://localhost/login');
  host.spinner();
  host.showSessionTimeout();
  host.setRoleAtOrganization('admin');

  expect(ui.lines).toEqual([
    'login http://localhost/login',
    'spinner',
    'timeout',
    'role admin',
  ]);
  await expect(host.waitForManualAuthCode()).resolves.toBe('code for 4');
  expect(host.abort).toBe(abort);
});

it('publishes the first login through its projection and reuses it', async () => {
  const user = { distinct_id: 'user-1' } as ApiUser;
  vi.mocked(getOrAskForProjectData).mockResolvedValue({
    accessToken: 'pha_test',
    projectApiKey: 'phc_test',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 42,
    roleAtOrganization: 'admin',
    user,
    project: null,
    missingScopes: [],
  });
  const session: AuthSession = {
    credentials: null,
    ci: false,
    signup: false,
    localMcp: false,
    apiProject: null,
    roleAtOrganization: null,
    apiUser: null,
  };
  const projection = {
    ...hostWithout(),
    setCredentials: vi.fn(),
    setRoleAtOrganization: vi.fn(),
    setApiUser: vi.fn(),
  };

  await authenticate(session, 'metrics', projection);
  await authenticate(session, 'metrics', projection);

  expect(getOrAskForProjectData).toHaveBeenCalledOnce();
  expect(vi.mocked(getOrAskForProjectData).mock.calls[0][1]).toBe(projection);
  expect(projection.setCredentials).toHaveBeenCalledExactlyOnceWith(
    session.credentials,
  );
  expect(projection.setRoleAtOrganization).toHaveBeenCalledExactlyOnceWith(
    'admin',
  );
  expect(projection.setApiUser).toHaveBeenCalledExactlyOnceWith(user);
});
