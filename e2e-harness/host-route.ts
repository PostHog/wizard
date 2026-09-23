/**
 * Which route the real TUI host takes, and where that route's control channel
 * is. The host resolves both before it starts the TUI, so a missing one is
 * readable on stderr instead of a crash from under a rendered screen.
 */

export const HOST_MODES = ['fixed', 'serve'] as const;
export type HostMode = (typeof HOST_MODES)[number];

export type HostRoute = { mode: HostMode; controlPath: string };

export type HostRouteResult =
  | { ok: true; route: HostRoute }
  | { ok: false; error: string };

/** The env var carrying each route's control channel, and what it is for. */
const CONTROL: Record<HostMode, { variable: string; use: string }> = {
  fixed: {
    variable: 'SNAP_CTRL',
    use: 'the host appends the name of each screen it snapshots to that file',
  },
  serve: {
    variable: 'CONTROL_SOCK',
    use: 'the host listens for commands on that socket path',
  },
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

  const { variable, use } = CONTROL[mode];
  const controlPath = env[variable];
  if (!controlPath)
    return {
      ok: false,
      error: `${variable} is not set, and MODE=${mode} needs it: ${use}.`,
    };

  return { ok: true, route: { mode, controlPath } };
}
