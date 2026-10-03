/**
 * The host reads its route from the environment. Each gap must name the
 * variable that closes it, rather than reaching `fs.appendFileSync` as
 * `undefined` and aborting the run with a Node type error.
 */

import { resolveHostRoute } from '@e2e-harness/host-route';

describe('resolveHostRoute', () => {
  it('resolves the snapshot route', () => {
    expect(resolveHostRoute({ MODE: 'fixed', SNAP_CTRL: '/tmp/ctrl' })).toEqual(
      { ok: true, route: { mode: 'fixed', controlPath: '/tmp/ctrl' } },
    );
  });

  it('resolves the socket route', () => {
    expect(
      resolveHostRoute({ MODE: 'serve', CONTROL_SOCK: '/tmp/sock' }),
    ).toEqual({ ok: true, route: { mode: 'serve', controlPath: '/tmp/sock' } });
  });

  it.each([
    ['no MODE', {}, /MODE is not set/],
    ['an unknown MODE', { MODE: 'snapshot' }, /MODE=snapshot is not a route/],
    ['no SNAP_CTRL', { MODE: 'fixed' }, /SNAP_CTRL is not set/],
    ['no CONTROL_SOCK', { MODE: 'serve' }, /CONTROL_SOCK is not set/],
  ])('names what is missing with %s', (_case, env, expected) => {
    const result = resolveHostRoute(env);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(expected);
  });

  it('offers both routes when MODE is the gap', () => {
    const result = resolveHostRoute({ SNAP_CTRL: '/tmp/ctrl' });
    expect(result.ok === false && result.error).toMatch(
      /MODE=fixed.*MODE=serve/,
    );
  });
});
