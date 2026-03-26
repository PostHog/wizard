import { getOrAskForProjectData, installPackage } from '../setup-utils';

import * as ChildProcess from 'node:child_process';
import type { PackageManager } from '../package-manager';
import { performOAuthFlow } from '../oauth';
import { fetchProjectData, fetchUserData } from '../../lib/api';
import {
  detectRegionFromToken,
  getCloudUrlFromRegion,
  getHostFromRegion,
} from '../urls';

jest.mock('node:child_process', () => ({
  __esModule: true,
  ...jest.requireActual('node:child_process'),
}));

jest.mock('../oauth', () => ({
  performOAuthFlow: jest.fn(),
}));

jest.mock('../../lib/api', () => ({
  fetchProjectData: jest.fn(),
  fetchUserData: jest.fn(),
}));

jest.mock('../urls', () => ({
  detectRegionFromToken: jest.fn(),
  getCloudUrlFromRegion: jest.fn(),
  getHostFromRegion: jest.fn(),
}));

jest.mock('../../ui', () => ({
  getUI: jest.fn().mockReturnValue({
    log: {
      info: jest.fn(),
      success: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      step: jest.fn(),
    },
    cancel: jest.fn(),
    outro: jest.fn(),
    intro: jest.fn(),
    spinner: jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      message: jest.fn(),
    })),
    setDetectedFramework: jest.fn(),
    setCredentials: jest.fn(),
    pushStatus: jest.fn(),
    syncTodos: jest.fn(),
    setLoginUrl: jest.fn(),
    showBlockingOutage: jest.fn(),
    setReadinessWarnings: jest.fn(),
    showSettingsOverride: jest.fn(),
    startRun: jest.fn(),
    note: jest.fn(),
  }),
}));

describe.skip('installPackage', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('force-installs a package if the forceInstall flag is set', async () => {
    const packageManagerMock: PackageManager = {
      name: 'npm',
      label: 'NPM',
      installCommand: 'npm install',
      buildCommand: 'npm run build',
      runScriptCommand: 'npm run',
      flags: '',
      forceInstallFlag: '--force',
      detect: jest.fn(),
      addOverride: jest.fn(),
    };

    const execSpy = jest
      .spyOn(ChildProcess, 'exec')
      // @ts-expect-error - don't care about the return value
      .mockImplementationOnce((cmd, cb) => {
        if (cb) {
          // @ts-expect-error - don't care about the options value
          cb(null, '', '');
        }
      });

    await installPackage({
      alreadyInstalled: false,
      packageName: 'posthog-js',
      packageNameDisplayLabel: 'posthog-js',
      forceInstall: true,
      packageManager: packageManagerMock,
      installDir: process.cwd(),
    });

    expect(execSpy).toHaveBeenCalledWith(
      'npm install posthog-js  --force',
      expect.any(Function),
    );
  });

  it.each([false, undefined])(
    "doesn't force-install a package if the forceInstall flag is %s",
    async (flag) => {
      const packageManagerMock: PackageManager = {
        name: 'npm',
        label: 'NPM',
        installCommand: 'npm install',
        buildCommand: 'npm run build',
        runScriptCommand: 'npm run',
        flags: '',
        forceInstallFlag: '--force',
        detect: jest.fn(),
        addOverride: jest.fn(),
      };

      const execSpy = jest
        .spyOn(ChildProcess, 'exec')
        // @ts-expect-error - don't care about the return value
        .mockImplementationOnce((cmd, cb) => {
          if (cb) {
            // @ts-expect-error - don't care about the options value
            cb(null, '', '');
          }
        });

      await installPackage({
        alreadyInstalled: false,
        packageName: 'posthog-js',
        packageNameDisplayLabel: 'posthog-js',
        forceInstall: flag,
        packageManager: packageManagerMock,
        installDir: process.cwd(),
      });

      expect(execSpy).toHaveBeenCalledWith(
        'npm install posthog-js  ',
        expect.any(Function),
      );
    },
  );
});

const mockPerformOAuthFlow = performOAuthFlow as jest.MockedFunction<
  typeof performOAuthFlow
>;
const mockFetchProjectData = fetchProjectData as jest.MockedFunction<
  typeof fetchProjectData
>;
const mockFetchUserData = fetchUserData as jest.MockedFunction<
  typeof fetchUserData
>;
const mockDetectRegionFromToken = detectRegionFromToken as jest.MockedFunction<
  typeof detectRegionFromToken
>;
const mockGetCloudUrlFromRegion = getCloudUrlFromRegion as jest.MockedFunction<
  typeof getCloudUrlFromRegion
>;
const mockGetHostFromRegion = getHostFromRegion as jest.MockedFunction<
  typeof getHostFromRegion
>;

describe('getOrAskForProjectData', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockDetectRegionFromToken.mockResolvedValue('eu');
    mockGetCloudUrlFromRegion.mockReturnValue('https://eu.posthog.com');
    mockGetHostFromRegion.mockReturnValue('https://eu.i.posthog.com');
  });

  it('bypasses OAuth when an API key is provided outside CI', async () => {
    mockFetchUserData.mockResolvedValue({
      distinct_id: 'user_123',
      organizations: [{ id: '11111111-1111-1111-1111-111111111111' }],
      team: {
        id: 42,
        organization: '11111111-1111-1111-1111-111111111111',
      },
      organization: { id: '11111111-1111-1111-1111-111111111111' },
    });
    mockFetchProjectData.mockResolvedValue({
      id: 42,
      uuid: '22222222-2222-2222-2222-222222222222',
      organization: '11111111-1111-1111-1111-111111111111',
      api_token: 'phc_project_token',
      name: 'Test project',
    });

    const result = await getOrAskForProjectData({
      signup: false,
      ci: false,
      apiKey: 'phx_personal_key',
    });

    expect(mockPerformOAuthFlow).not.toHaveBeenCalled();
    expect(mockDetectRegionFromToken).toHaveBeenCalledWith('phx_personal_key');
    expect(mockFetchUserData).toHaveBeenCalledWith(
      'phx_personal_key',
      'https://eu.posthog.com',
    );
    expect(mockFetchProjectData).toHaveBeenCalledWith(
      'phx_personal_key',
      42,
      'https://eu.posthog.com',
    );
    expect(result).toEqual({
      host: 'https://eu.i.posthog.com',
      projectApiKey: 'phc_project_token',
      accessToken: 'phx_personal_key',
      projectId: 42,
      cloudRegion: 'eu',
    });
  });

  it('uses an explicit project id with an API key without OAuth', async () => {
    mockFetchProjectData.mockResolvedValue({
      id: 99,
      uuid: '33333333-3333-3333-3333-333333333333',
      organization: '11111111-1111-1111-1111-111111111111',
      api_token: 'phc_project_token_99',
      name: 'Explicit project',
    });

    const result = await getOrAskForProjectData({
      signup: false,
      ci: false,
      apiKey: 'phx_personal_key',
      projectId: 99,
    });

    expect(mockPerformOAuthFlow).not.toHaveBeenCalled();
    expect(mockFetchUserData).not.toHaveBeenCalled();
    expect(mockFetchProjectData).toHaveBeenCalledWith(
      'phx_personal_key',
      99,
      'https://eu.posthog.com',
    );
    expect(result.projectId).toBe(99);
    expect(result.projectApiKey).toBe('phc_project_token_99');
  });
});
