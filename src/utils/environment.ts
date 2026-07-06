import readEnvModule from 'read-env';

const readEnv =
  typeof readEnvModule === 'function'
    ? readEnvModule
    : (readEnvModule as any).default;
import { tryGetPackageJson } from './setup-utils';
import type { WizardRunOptions } from './types';
import fg from 'fast-glob';
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
 * Whether stdin can enter raw mode — the Ink TUI's hard requirement.
 *
 * Ink's `useInput` mounts an effect that calls `stdin.setRawMode`, which throws
 * "Raw mode is not supported" when stdin isn't a raw-mode-capable TTY (piped
 * input, CI, sandboxed `npx` shells, some IDE terminals). That throw fires
 * inside a React passive effect, so it escapes any try/catch around `render()`
 * and crashes the process. Mirror Ink's own condition here so callers can
 * detect the situation *before* rendering and degrade gracefully instead.
 */
export function isRawModeSupported(): boolean {
  return (
    Boolean(process.stdin.isTTY) &&
    typeof process.stdin.setRawMode === 'function'
  );
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
  const hasAnyFile = async (patterns: string[]) => {
    const matches = await fg(patterns, {
      cwd: options.installDir,
      absolute: false,
      onlyFiles: true,
      ignore: ['**/node_modules/**'],
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
