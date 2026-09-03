import * as os from 'os';
import * as path from 'path';

/**
 * A half-written `~/.npm/_npx` extraction leaves a dependency directory without
 * a readable package.json, and Node then fails the dynamic import with
 * ERR_MODULE_NOT_FOUND. The install is corrupt, not the API — the user fixes it
 * by deleting the cached download and running the wizard again.
 */
export function isModuleNotFoundError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)/i.test(message);
}

/**
 * The exact download to delete, taken from the path Node names in the failure
 * (`.../_npx/<hash>/node_modules/...`). Falls back to the whole npx cache when
 * the message carries no such path.
 */
function npxCacheDir(message: string): string {
  const match = /([^\s'"]*[/\\]_npx[/\\][^/\\'"]+)/.exec(message);
  if (match) return match[1];
  return process.platform === 'win32'
    ? path.join(
        process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
        'npm-cache',
        '_npx',
      )
    : path.join(os.homedir(), '.npm', '_npx');
}

export function formatModuleMissingMessage(message: string): string {
  const dir = npxCacheDir(message);
  const remove =
    process.platform === 'win32'
      ? `Remove-Item -Recurse -Force "${dir}"`
      : `rm -rf "${dir}"`;
  return [
    'Broken npx download',
    '',
    'The wizard could not load one of its own dependencies. The npx cache holds',
    'an incomplete copy of it. Nothing is wrong with your project.',
    '',
    'Delete the cached download:',
    '',
    `  ${remove}`,
    '',
    // Not a literal rerun command: every wizard command reaches this message,
    // so naming the default flow would send an `audit` user into an install.
    'Then run the same wizard command again. npx fetches a fresh copy.',
    '',
    `Details: ${message}`,
    '',
    'Still stuck? Email wizard@posthog.com and we will help.',
  ].join('\n');
}
