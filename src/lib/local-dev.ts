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

// Retries because this gate gates `fetchWithRetry` (see fetch-retry.ts) — a
// blip it would ride out must not abort the run instead. A missing server
// refuses instantly, so the retries only cost time when one is slow to answer,
// which is exactly when they're worth paying for.
const PROBE_TIMEOUT_MS = 2_000;
const PROBE_ATTEMPTS = 3;
const PROBE_BACKOFF_MS = 250;

async function isReachable(url: string): Promise<boolean> {
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
    try {
      // Any reply — including 404 or 405 — proves something is listening, which
      // is the only question here. Deliberately not `fetchWithRetry`: that
      // treats a non-ok status as failure, and here it is a pass.
      await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      return true;
    } catch {
      if (attempt < PROBE_ATTEMPTS) {
        await new Promise((r) =>
          setTimeout(r, PROBE_BACKOFF_MS * 2 ** (attempt - 1)),
        );
      }
    }
  }
  return false;
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
