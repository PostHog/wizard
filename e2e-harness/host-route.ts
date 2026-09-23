/**
 * Which route the real TUI host takes, and where that route's control channel
 * is. Both come from the environment, and the host reads them before it starts
 * the TUI: a missing one is reported on stderr, not as a crash from inside a
 * run that has already taken the screen.
 */

export const HOST_MODES = ['fixed', 'serve'] as const;
export type HostMode = (typeof HOST_MODES)[number];

export type HostRoute = { mode: HostMode; controlPath: string };

export type HostRouteResult =
  | { ok: true; route: HostRoute }
  | { ok: false; error: string };

/** The env var that carries each route's control channel. */
const CONTROL_VAR: Record<HostMode, string> = {
  fixed: 'SNAP_CTRL',
  serve: 'CONTROL_SOCK',
};

const CONTROL_USE: Record<HostMode, string> = {
  fixed: 'the host appends the name of each screen it snapshots to that file',
  serve: 'the host listens for commands on that socket path',
};

const MODE_HELP =
  'Set MODE=fixed to self-drive the e2e profile, or MODE=serve to accept socket commands.';

function isHostMode(value: string | undefined): value is HostMode {
  return HOST_MODES.includes(value as HostMode);
}

export function resolveHostRoute(env: NodeJS.ProcessEnv): HostRouteResult {
  const mode = env.MODE;
  if (!mode) return { ok: false, error: `MODE is not set. ${MODE_HELP}` };
  if (!isHostMode(mode))
    return { ok: false, error: `MODE=${mode} is not a route. ${MODE_HELP}` };

  const variable = CONTROL_VAR[mode];
  const controlPath = env[variable];
  if (!controlPath)
    return {
      ok: false,
      error: `${variable} is not set, and MODE=${mode} needs it: ${CONTROL_USE[mode]}.`,
    };

  return { ok: true, route: { mode, controlPath } };
}
