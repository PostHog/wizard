/** The control-socket flags: which runs may serve the control API, and in which mode. */
import { HEADLESS_FLAG } from '@env';
import type { ControlMode } from '@shared/control/types';

export const CONTROL_SOCKET_UNAVAILABLE =
  '--control-socket is only available with the experimental headless flag in published builds.';
export const CONTROL_MODE_NEEDS_SOCKET =
  '--partial-control and --full-control only apply with --control-socket.';
export const CONTROL_MODES_EXCLUSIVE =
  '--partial-control and --full-control cannot be combined.';

/** Hidden options every command accepts; the refusal below decides whether a run may use them. */
export const CONTROL_OPTIONS = {
  'control-socket': {
    describe:
      'Serve the control API over this unix socket path\nenv: POSTHOG_WIZARD_CONTROL_SOCKET',
    type: 'string' as const,
    hidden: true,
  },
  'partial-control': {
    describe:
      'Control mode: the socket may only make the commits a user could (default)\nenv: POSTHOG_WIZARD_PARTIAL_CONTROL',
    type: 'boolean' as const,
    hidden: true,
  },
  'full-control': {
    describe:
      'Control mode: the socket may also call any store setter, whatever the screen or phase\nenv: POSTHOG_WIZARD_FULL_CONTROL',
    type: 'boolean' as const,
    hidden: true,
  },
};

const hasFlag = (args: readonly string[], flag: string): boolean =>
  args.some(
    (a) =>
      a === `--${flag}` || a === `--no-${flag}` || a.startsWith(`--${flag}=`),
  );
const hasEnv = (env: NodeJS.ProcessEnv, key: string): boolean =>
  env[key] != null && env[key] !== '';

/** The refusal to print for a control-flag misuse, or null to proceed. */
export function controlFlagRefusal(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  publishedBuild: boolean,
): string | null {
  const wantsSocket =
    hasFlag(args, 'control-socket') ||
    hasEnv(env, 'POSTHOG_WIZARD_CONTROL_SOCKET');
  const partial =
    hasFlag(args, 'partial-control') ||
    hasEnv(env, 'POSTHOG_WIZARD_PARTIAL_CONTROL');
  const full =
    hasFlag(args, 'full-control') || hasEnv(env, 'POSTHOG_WIZARD_FULL_CONTROL');
  if (partial && full) return CONTROL_MODES_EXCLUSIVE;
  if ((partial || full) && !wantsSocket) return CONTROL_MODE_NEEDS_SOCKET;
  if (publishedBuild && wantsSocket && !hasFlag(args, HEADLESS_FLAG)) {
    return CONTROL_SOCKET_UNAVAILABLE;
  }
  return null;
}

/** The control mode parsed options select: partial unless full control was asked for. */
export function controlMode(options: Record<string, unknown>): ControlMode {
  return options.fullControl === true ? 'full' : 'partial';
}
