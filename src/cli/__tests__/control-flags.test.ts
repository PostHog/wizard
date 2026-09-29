import {
  CONTROL_MODE_NEEDS_SOCKET,
  CONTROL_MODES_EXCLUSIVE,
  CONTROL_SOCKET_UNAVAILABLE,
  controlFlagRefusal,
  controlMode,
} from '../control-flags';
import { HEADLESS_FLAG } from '@env';

describe('control flags', () => {
  it('allows a socket in dev builds, with or without a mode', () => {
    expect(
      controlFlagRefusal(['--control-socket=/tmp/s'], {}, false),
    ).toBeNull();
    expect(
      controlFlagRefusal(
        ['--control-socket', '/tmp/s', '--full-control'],
        {},
        false,
      ),
    ).toBeNull();
  });

  it('refuses a mode without a socket, and both modes together', () => {
    expect(controlFlagRefusal(['--full-control'], {}, false)).toBe(
      CONTROL_MODE_NEEDS_SOCKET,
    );
    expect(
      controlFlagRefusal(
        ['--control-socket=/s', '--partial-control', '--full-control'],
        {},
        false,
      ),
    ).toBe(CONTROL_MODES_EXCLUSIVE);
    expect(
      controlFlagRefusal([], { POSTHOG_WIZARD_FULL_CONTROL: 'true' }, false),
    ).toBe(CONTROL_MODE_NEEDS_SOCKET);
  });

  it('ships the socket in published builds only with the headless flag', () => {
    expect(controlFlagRefusal(['--control-socket=/s'], {}, true)).toBe(
      CONTROL_SOCKET_UNAVAILABLE,
    );
    expect(
      controlFlagRefusal([], { POSTHOG_WIZARD_CONTROL_SOCKET: '/s' }, true),
    ).toBe(CONTROL_SOCKET_UNAVAILABLE);
    expect(
      controlFlagRefusal(
        ['--control-socket=/s', `--${HEADLESS_FLAG}`],
        {},
        true,
      ),
    ).toBeNull();
  });

  it('defaults to partial control and never turns full control on by itself', () => {
    expect(controlMode({ controlSocket: '/s' })).toBe('partial');
    expect(controlMode({ controlSocket: '/s', partialControl: true })).toBe(
      'partial',
    );
    expect(controlMode({ controlSocket: '/s', fullControl: true })).toBe(
      'full',
    );
  });
});
