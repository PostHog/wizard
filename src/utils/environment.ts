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

export function readEnvironment(): Record<string, unknown> {
  const result = readEnv('POSTHOG_WIZARD');

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
