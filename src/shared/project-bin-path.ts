import * as fs from 'node:fs';
import * as path from 'node:path';

// An empty or unset PATH can search the working directory on Unix.
const UNIX_FALLBACK = '/usr/bin:/bin';

const real = (directory: string): string => {
  try {
    return fs.realpathSync(directory);
  } catch {
    return path.resolve(directory);
  }
};

const comparable = (directory: string): string =>
  process.platform === 'win32' ? directory.toLowerCase() : directory;

/** The `node_modules/.bin` folders `npx` adds: the working directory's and each parent's. */
function projectBins(cwd: string): Set<string> {
  const bins = new Set<string>();
  for (const start of [path.resolve(cwd), real(cwd)]) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      bins.add(comparable(path.join(dir, 'node_modules', '.bin')));
      if (path.dirname(dir) === dir) break;
    }
  }
  return bins;
}

/**
 * `searchPath` without the project's `node_modules/.bin` folders and relative
 * entries. `npx` puts those folders first, so without this a repository can
 * plant any command the wizard or a dependency runs by name. Other
 * `node_modules/.bin` folders stay: package managers and global tools can live
 * in one, such as pnpm under `pnpm/action-setup`.
 */
export function withoutProjectBins(
  searchPath: string,
  cwd: string = process.cwd(),
): string {
  const bins = projectBins(cwd);
  const kept = searchPath
    .split(path.delimiter)
    .filter((entry) => {
      // Only Windows treats quotes in PATH as quoting; elsewhere they're part of a relative name.
      const directory =
        process.platform === 'win32' ? entry.replace(/^"(.*)"$/, '$1') : entry;
      return (
        directory &&
        path.isAbsolute(directory) &&
        !bins.has(comparable(path.resolve(directory))) &&
        !bins.has(comparable(real(directory)))
      );
    })
    .join(path.delimiter);
  return kept || (process.platform === 'win32' ? '' : UNIX_FALLBACK);
}
