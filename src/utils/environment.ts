import readEnvModule from 'read-env';

const readEnv =
  typeof readEnvModule === 'function'
    ? readEnvModule
    : (readEnvModule as any).default;
import { tryGetPackageJson } from './setup-utils';
import type { WizardRunOptions } from './types';
import { boundedGlob } from './bounded-fs';
import { IS_DEV } from '@lib/constants';

export function isNonInteractiveEnvironment(): boolean {
  if (IS_DEV) {
    return false;
  }

  if (!process.stdout.isTTY || !process.stderr.isTTY) {
    return true;
  }

  return false;
}

/**
 * Session fields the environment must never set, matched case-insensitively
 * against the camel-cased key `read-env` produces.
 *
 * `e2eAsk` re-wires the `wizard_ask` bridge in an otherwise non-interactive
 * run. Only the e2e TUI host may set it: a real `--ci` run has nobody to answer,
 * so every question would stall for the bridge timeout instead of failing fast
 * with an actionable error. See `shouldDisableAsk`.
 */
const NEVER_FROM_ENV = ['e2eAsk'];

/**
 * Session args from the `POSTHOG_WIZARD_*` environment variables.
 *
 * `read-env` camel-cases every prefixed variable into a key, and the CI runner
 * spreads the whole bag into `buildSession` — so adding a field to the session
 * silently adds an environment variable that sets it. Most of them are meant to
 * work that way (`POSTHOG_WIZARD_DEBUG` → `debug`); the ones in
 * {@link NEVER_FROM_ENV} are not, and are dropped here rather than at the call
 * site, so a second caller cannot reopen the door.
 */
export function readEnvironment(): Record<string, unknown> {
  const result = readEnv('POSTHOG_WIZARD') as Record<string, unknown>;

  for (const key of Object.keys(result)) {
    if (NEVER_FROM_ENV.some((k) => k.toLowerCase() === key.toLowerCase())) {
      delete result[key];
    }
  }

  return result;
}

export async function detectEnvVarPrefix(
  options: WizardRunOptions,
): Promise<string> {
  const packageJson = await tryGetPackageJson(options);
  if (!packageJson) return 'VITE_PUBLIC_';

  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const has = (name: string) => name in deps;
  // O(1) matches per probe: one config file existing anywhere answers it.
  const hasAnyFile = async (patterns: string[]) => {
    const matches = await boundedGlob(patterns, {
      cwd: options.installDir,
      limit: 1,
    });
    return matches.length > 0;
  };

  // --- Next.js
  if (has('next') || (await hasAnyFile(['**/next.config.{js,ts,mjs,cjs}']))) {
    return 'NEXT_PUBLIC_';
  }

  // --- Create React App
  if (
    has('react-scripts') ||
    has('create-react-app') ||
    (await hasAnyFile(['**/config-overrides.js']))
  ) {
    return 'REACT_APP_';
  }

  // --- Vite (vanilla, TanStack, Solid, etc.)
  // Note: Vite does not need PUBLIC_ but we use it to follow the docs, to improve the chances of an LLM getting it right.
  if (has('vite') || (await hasAnyFile(['**/vite.config.{js,ts,mjs,cjs}']))) {
    return 'VITE_PUBLIC_';
  }

  // --- SvelteKit
  if (
    has('@sveltejs/kit') ||
    (await hasAnyFile(['**/svelte.config.{js,ts}']))
  ) {
    return 'PUBLIC_';
  }

  // --- TanStack Start (uses Vite)
  if (
    has('@tanstack/start') ||
    (await hasAnyFile(['**/tanstack.config.{js,ts}']))
  ) {
    return 'VITE_PUBLIC_';
  }

  // --- SolidStart (uses Vite)
  if (has('solid-start') || (await hasAnyFile(['**/solid.config.{js,ts}']))) {
    return 'VITE_PUBLIC_';
  }

  // --- Astro
  if (has('astro') || (await hasAnyFile(['**/astro.config.{js,ts,mjs}']))) {
    return 'PUBLIC_';
  }

  // We default to Vite if we can't detect a specific framework, since it's the most commonly used.
  return 'VITE_PUBLIC_';
}
