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
 * the message carries no absolute path of that shape.
 */
function npxCacheDir(message: string): string {
  // The part before `_npx` has to tolerate spaces — a Windows profile is
  // routinely `C:\Users\John Smith` — so it is fenced by the quotes Node puts
  // around a specifier rather than by whitespace, and it has to start at a real
  // root (`/`, a drive, or a UNC share). Half a path is worse than none: a
  // relative `rm -rf` matches nothing and exits 0, so the user believes the
  // cache is clear and hits the same failure. No match instead sends them to
  // the whole-cache fallback below, which does unstick them.
  const match =
    /(?:^|[\s'"])((?:[A-Za-z]:[/\\]|\\\\|\/)[^'"]*?[/\\]_npx[/\\][^\s/\\'"]+)/.exec(
      message,
    );
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
