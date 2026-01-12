import { installPackage } from '../clack-utils';

import * as ChildProcess from 'node:child_process';
import type { PackageManager } from '../package-manager';

jest.mock('node:child_process', () => ({
  __esModule: true,
  ...jest.requireActual('node:child_process'),
}));

jest.mock('@clack/prompts', () => ({
  log: {
    info: jest.fn(),
    success: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  text: jest.fn(),
  confirm: jest.fn(),
  cancel: jest.fn(),
  outro: jest.fn(),
  // passthrough for abortIfCancelled
  isCancel: jest.fn().mockReturnValue(false),
  spinner: jest
    .fn()
    .mockImplementation(() => ({ start: jest.fn(), stop: jest.fn() })),
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
      askBeforeUpdating: false,
      packageManager: packageManagerMock,
      options: { installDir: process.cwd(), ci: false },
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
        askBeforeUpdating: false,
        packageManager: packageManagerMock,
        options: { installDir: process.cwd(), ci: false },
      });

      expect(execSpy).toHaveBeenCalledWith(
        'npm install posthog-js  ',
        expect.any(Function),
      );
    },
  );
});
