import * as path from 'node:path';

const NODE_BIN = /(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/i;

// An empty or unset PATH can search the working directory on Unix.
const UNIX_FALLBACK = '/usr/bin:/bin';

/**
 * `searchPath` without `node_modules/.bin` folders and relative entries. `npx`
 * puts the project's `node_modules/.bin` first, so without this a repository can
 * plant any command the wizard or a dependency runs by name.
 */
export function withoutProjectBins(searchPath: string): string {
  const kept = searchPath
    .split(path.delimiter)
    .filter((entry) => {
      // Only Windows treats quotes in PATH as quoting; elsewhere they're part of a relative name.
      const directory =
        process.platform === 'win32' ? entry.replace(/^"(.*)"$/, '$1') : entry;
      return (
        directory && path.isAbsolute(directory) && !NODE_BIN.test(directory)
      );
    })
    .join(path.delimiter);
  return kept || (process.platform === 'win32' ? '' : UNIX_FALLBACK);
}
