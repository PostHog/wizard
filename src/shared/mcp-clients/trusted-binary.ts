/**
 * Find an MCP client's CLI on PATH without trusting copies the current project
 * can plant. `npx` puts the project's `node_modules/.bin` on PATH, and a
 * repository can check one in, so a bare `command -v codex` can resolve to
 * repository code that then runs as the user.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runtimeEnv } from '@env';

const NODE_BIN = `${path.sep}node_modules${path.sep}.bin`;

const realOrResolved = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** Whether `child` is `parent` or somewhere under it. */
const isWithin = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const inNodeBin = (p: string): boolean =>
  p.endsWith(NODE_BIN) || p.includes(`${NODE_BIN}${path.sep}`);

/**
 * The directory whose files count as the project's: the working directory,
 * unless it is the home directory or above it, where everything the user
 * installed under `~` would otherwise count as untrusted.
 */
const projectRoot = (): string | null => {
  const cwd = realOrResolved(process.cwd());
  return isWithin(realOrResolved(os.homedir()), cwd) ? null : cwd;
};

/**
 * The real path of the first executable `name` on PATH that the project can't
 * have placed there: relative PATH entries, `node_modules/.bin` folders, and
 * files (or symlink targets) inside the project are skipped, and the search
 * moves on to the next PATH entry. Null when there is none.
 */
export function findTrustedBinary(name: string): string | null {
  const root = projectRoot();
  for (const dir of (runtimeEnv('PATH') ?? '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir) || inNodeBin(dir)) continue;
    const file = path.join(dir, name);
    let real: string;
    try {
      if (!fs.statSync(file).isFile()) continue;
      fs.accessSync(file, fs.constants.X_OK);
      real = fs.realpathSync(file);
    } catch {
      continue;
    }
    if (inNodeBin(path.dirname(real))) continue;
    if (root && (isWithin(file, root) || isWithin(real, root))) continue;
    return real;
  }
  return null;
}
