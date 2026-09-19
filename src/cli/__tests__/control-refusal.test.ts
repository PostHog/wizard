import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@env')>()),
  IS_PRODUCTION_BUILD: true,
}));
vi.mock('@store/shared/errors/emit', () => ({ emitWizardError: vi.fn() }));

import { HEADLESS_FLAG } from '@env';
import { emitWizardError } from '@store/shared/errors/emit';
import { basicIntegrationCommand } from '../commands/basic-integration/index.js';
import {
  CONTROL_SOCKET_UNAVAILABLE,
  controlFlagRefusal,
  E2E_ASK_UNAVAILABLE,
  Wizard,
} from '../wizard.js';

class Exit extends Error {}

describe('published-build control flag refusal', () => {
  it.each([
    [
      '--control-socket alone',
      ['--control-socket', '/tmp/c.sock'],
      {},
      CONTROL_SOCKET_UNAVAILABLE,
    ],
    [
      '--control-socket= alone',
      ['--control-socket=/tmp/c.sock'],
      {},
      CONTROL_SOCKET_UNAVAILABLE,
    ],
    [
      'env alone',
      [],
      { POSTHOG_WIZARD_CONTROL_SOCKET: '/tmp/c.sock' },
      CONTROL_SOCKET_UNAVAILABLE,
    ],
    [
      '--control-socket with headless',
      [`--${HEADLESS_FLAG}`, '--control-socket', '/tmp/c.sock'],
      {},
      null,
    ],
    [
      'env with headless',
      [`--${HEADLESS_FLAG}`],
      { POSTHOG_WIZARD_CONTROL_SOCKET: '/tmp/c.sock' },
      null,
    ],
    ['--e2e-ask', ['--e2e-ask'], {}, E2E_ASK_UNAVAILABLE],
    [
      '--e2e-ask env',
      [],
      { POSTHOG_WIZARD_E2E_ASK: 'true' },
      E2E_ASK_UNAVAILABLE,
    ],
    [
      '--e2e-ask even with headless',
      [`--${HEADLESS_FLAG}`, '--e2e-ask'],
      {},
      E2E_ASK_UNAVAILABLE,
    ],
    ['nothing', ['--install-dir', '/tmp/app'], {}, null],
  ] as const)('%s', (_label, args, env, expected) => {
    expect(controlFlagRefusal(args, env)).toBe(expected);
  });
});

describe('published-build init', () => {
  const argv = process.argv;
  let stderr: string[];
  beforeEach(() => {
    stderr = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Exit('exit');
    });
    delete process.env.POSTHOG_WIZARD_CONTROL_SOCKET;
  });
  afterEach(() => {
    process.argv = argv;
    vi.restoreAllMocks();
    vi.mocked(emitWizardError).mockClear();
  });

  it('prints the refusal and emits the machine readable error', () => {
    process.argv = [
      'node',
      'wizard',
      '--control-socket',
      '/tmp/c.sock',
      '--install-dir',
      '/tmp/app',
    ];
    expect(() => Wizard.use(basicIntegrationCommand).init()).toThrow(Exit);
    expect(stderr.join('')).toContain(CONTROL_SOCKET_UNAVAILABLE);
    expect(emitWizardError).toHaveBeenCalledWith(
      expect.objectContaining({ message: CONTROL_SOCKET_UNAVAILABLE }),
    );
  });
});
