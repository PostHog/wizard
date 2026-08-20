/**
 * Local development targets: context-mill (skills), MCP, and PostHog. Each is
 * independently switchable — CI runs local skills against the *production* MCP
 * — with `--local-dev` as a shorthand for all three.
 *
 * `wizard mcp add --local` is unrelated: it writes a `posthog-local` entry into
 * the user's editor config rather than retargeting this run. Hence no
 * `--local` here.
 */

export const CONTEXT_MILL_LOCAL_URL = 'http://localhost:8765';
export const MCP_LOCAL_URL = 'http://localhost:8787/mcp';
/** Pins the API, app, OAuth, and the LLM gateway derived from them. */
export const POSTHOG_LOCAL_URL = 'http://localhost:8010';

/**
 * Raw yargs values. The three specific flags are declared without a `default`
 * so they stay `undefined` when absent — see `resolveLocalDev`.
 */
export type LocalDevFlags = {
  localDev?: boolean;
  localMcp?: boolean;
  localContextMill?: boolean;
  localPosthog?: boolean;
};

export type ResolvedLocalDev = {
  localMcp: boolean;
  localContextMill: boolean;
  localPosthog: boolean;
};

/**
 * A specific flag beats `--local-dev` in both directions. `??` is load-bearing:
 * it falls through only on `undefined`, so giving the specific flags a yargs
 * `default: false` would silently break both the umbrella and `--no-local-mcp`.
 */
export function resolveLocalDev(flags: LocalDevFlags): ResolvedLocalDev {
  const umbrella = flags.localDev ?? false;
  return {
    localMcp: flags.localMcp ?? umbrella,
    localContextMill: flags.localContextMill ?? umbrella,
    localPosthog: flags.localPosthog ?? umbrella,
  };
}

/**
 * For handlers that never build a `WizardSession` (the skill and family
 * dispatchers). yargs populates both spellings, so read either.
 */
export function localDevFromArgv(
  argv: Record<string, unknown>,
): ResolvedLocalDev {
  const read = (kebab: string, camel: string): boolean | undefined => {
    const value = argv[camel] ?? argv[kebab];
    return typeof value === 'boolean' ? value : undefined;
  };
  return resolveLocalDev({
    localDev: read('local-dev', 'localDev'),
    localMcp: read('local-mcp', 'localMcp'),
    localContextMill: read('local-context-mill', 'localContextMill'),
    localPosthog: read('local-posthog', 'localPosthog'),
  });
}

type LocalService = {
  key: keyof ResolvedLocalDev;
  label: string;
  flag: string;
  /** Probed for reachability — any HTTP reply proves the port is bound. */
  url: string;
  startHint: string;
};

const LOCAL_SERVICES: readonly LocalService[] = [
  {
    key: 'localContextMill',
    label: 'context-mill',
    flag: '--local-context-mill',
    url: `${CONTEXT_MILL_LOCAL_URL}/skill-menu.json`,
    startHint: 'npm run dev  (in the context-mill repo)',
  },
  {
    key: 'localMcp',
    label: 'MCP server',
    flag: '--local-mcp',
    url: MCP_LOCAL_URL,
    startHint:
      'hogli start  (or pnpm dev:local-resources in posthog/services/mcp)',
  },
  {
    key: 'localPosthog',
    label: 'PostHog',
    flag: '--local-posthog',
    url: POSTHOG_LOCAL_URL,
    startHint: './bin/start  (in the posthog repo)',
  },
] as const;

/** localhost binds instantly or not at all, so no retries and a short budget. */
const PROBE_TIMEOUT_MS = 2_000;

async function isReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Any reply — including 404 or 405 — proves something is listening, which
    // is the only question here. Whether it serves what we want is the caller's
    // problem to report later, with its own better-shaped error.
    await fetch(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe every service the flags asked to be local. Returns one message naming
 * each unreachable one, or undefined if all are up (or none were requested).
 *
 * Without this a dead local server surfaces late and badly: a missing
 * context-mill looks like a registry outage, a missing MCP fails mid-run after
 * the agent has already edited files.
 */
export async function checkLocalServices(
  resolved: ResolvedLocalDev,
): Promise<string | undefined> {
  const requested = LOCAL_SERVICES.filter((s) => resolved[s.key]);
  if (requested.length === 0) return undefined;

  const reachable = await Promise.all(requested.map((s) => isReachable(s.url)));
  const dead = requested.filter((_, i) => !reachable[i]);
  if (dead.length === 0) return undefined;

  return [
    `Local ${dead.length === 1 ? 'service is' : 'services are'} not running:`,
    '',
    ...dead.map(
      (s) =>
        `  ${s.label} — nothing listening at ${new URL(s.url).origin}\n` +
        `    requested by ${s.flag}\n` +
        `    start it with: ${s.startHint}`,
    ),
    '',
    'Start the missing services, or drop the flag to use production.',
  ].join('\n');
}

/**
 * `--local-mcp` used to select local skills too; anyone still relying on that
 * would silently get production skills. Temporary — drop after a release or two.
 */
export function localMcpSkillsNotice(flags: LocalDevFlags): string | undefined {
  if (flags.localMcp !== true) return undefined;
  if (flags.localContextMill !== undefined || flags.localDev === true) {
    return undefined;
  }
  return (
    '--local-mcp now points only at the local MCP server. ' +
    'For local skills, add --local-context-mill (or use --local-dev for both).'
  );
}
