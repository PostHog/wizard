import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Arguments } from 'yargs';

const runners = vi.hoisted(() => ({
  runWizard: vi.fn(),
  runWizardCI: vi.fn(),
  runWizardHeadless: vi.fn(),
}));
vi.mock('../runners/index.js', () => runners);

import { HEADLESS_FLAG } from '@env';
import {
  errorTrackingUploadSourceMapsConfig,
  posthogIntegrationConfig,
  selfDrivingConfig,
} from '@store/programs';
import { selfDrivingCommand } from '../commands/self-driving.js';
import { uploadSourcemapsCommand } from '../commands/upload-sourcemaps.js';
import { dispatchProgram } from '../commands/factories/shared.js';
import { GLOBAL_OPTIONS } from '../wizard.js';

const argv = (extra: Record<string, unknown>): Arguments =>
  ({ _: [], $0: 'wizard', ...extra } as Arguments);

describe('control socket flag', () => {
  it('is a hidden global string option', () => {
    expect(GLOBAL_OPTIONS['control-socket']).toMatchObject({
      type: 'string',
      hidden: true,
    });
  });
});

describe('surface dispatch', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it.each([
    [
      'headless + socket',
      { [HEADLESS_FLAG]: true, controlSocket: '/tmp/c.sock' },
      'runWizardHeadless',
    ],
    ['headless alone', { [HEADLESS_FLAG]: true }, 'runWizardHeadless'],
    ['ci + socket', { ci: true, controlSocket: '/tmp/c.sock' }, 'runWizard'],
    ['ci alone', { ci: true }, 'runWizardCI'],
    ['socket alone', { controlSocket: '/tmp/c.sock' }, 'runWizard'],
    ['no flags', {}, 'runWizard'],
  ] as const)('%s routes to %s', (_label, flags, runner) => {
    dispatchProgram(posthogIntegrationConfig, argv(flags));
    for (const name of [
      'runWizard',
      'runWizardCI',
      'runWizardHeadless',
    ] as const) {
      expect(runners[name], name).toHaveBeenCalledTimes(
        name === runner ? 1 : 0,
      );
    }
    expect(runners[runner]).toHaveBeenCalledWith(
      posthogIntegrationConfig,
      expect.objectContaining(flags),
    );
  });
});

describe('commands with their own handlers follow the same dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('self-driving refuses --ci alone and accepts it with a control socket', () => {
    expect(() => selfDrivingCommand.check?.(argv({ ci: true }))).toThrow(
      /cannot run in CI mode/,
    );
    expect(
      selfDrivingCommand.check?.(
        argv({ ci: true, controlSocket: '/tmp/c.sock' }),
      ),
    ).toBe(true);
  });

  it.each([
    ['self-driving', selfDrivingCommand, selfDrivingConfig],
    [
      'upload-source-maps',
      uploadSourcemapsCommand,
      errorTrackingUploadSourceMapsConfig,
    ],
  ] as const)(
    '%s routes ci + socket to the controlled TUI',
    (_name, command, config) => {
      command.handler?.(argv({ ci: true, controlSocket: '/tmp/c.sock' }));
      expect(runners.runWizard).toHaveBeenCalledWith(
        config,
        expect.objectContaining({ ci: true, controlSocket: '/tmp/c.sock' }),
      );
      expect(runners.runWizardCI).not.toHaveBeenCalled();
      vi.clearAllMocks();
      command.handler?.(argv({ ci: true }));
      expect(runners.runWizardCI).toHaveBeenCalledTimes(1);
    },
  );
});
