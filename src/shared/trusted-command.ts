import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import readCmdShim from 'read-cmd-shim';

const isWithin = (child: string, parent: string): boolean => {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

const realOrResolved = (file: string): string => {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
};

function projectRoot(directory: string): string | null {
  const start = realOrResolved(directory);
  const home = realOrResolved(os.homedir());
  if (isWithin(home, start)) return null;
  let root = start;
  for (let current = start; ; current = path.dirname(current)) {
    if (current === home || path.dirname(current) === current) break;
    if (fs.existsSync(path.join(current, '.git'))) root = current;
  }
  return root;
}

function trustPolicy(installDir: string) {
  const roots = [process.cwd(), installDir]
    .map(projectRoot)
    .filter((root): root is string => root !== null);
  return (file: string): boolean => {
    const normalized = path.resolve(file);
    const real = realOrResolved(file);
    const nodeBin = /(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/i;
    return (
      !nodeBin.test(normalized) &&
      !nodeBin.test(real) &&
      !roots.some((root) => isWithin(normalized, root) || isWithin(real, root))
    );
  };
}

/** A child-only environment; never remove user tools from the parent process. */
export function trustedCommandEnv(
  installDir: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed = trustPolicy(installDir);
  const windows = process.platform === 'win32';
  const pathKeys = Object.keys(environment).filter((key) =>
    windows ? key.toUpperCase() === 'PATH' : key === 'PATH',
  );
  const searchPath = environment[pathKeys.sort()[0]] ?? '';
  const env = { ...environment };
  for (const key of pathKeys) delete env[key];
  env.PATH = searchPath
    .split(path.delimiter)
    .map((directory) => directory.replace(/^"(.*)"$/, '$1'))
    .filter(
      (directory) =>
        directory && path.isAbsolute(directory) && allowed(directory),
    )
    .join(path.delimiter);
  if (windows) env.NoDefaultCurrentDirectoryInExePath = '1';
  return env;
}

function* trustedBinaries(
  name: string,
  installDir: string,
  extensions: string[],
  env: NodeJS.ProcessEnv,
): Generator<string, void, unknown> {
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..') return;
  const allowed = trustPolicy(installDir);
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const file = path.join(directory, name + extension);
      try {
        if (!allowed(file) || !fs.statSync(file).isFile()) continue;
        fs.accessSync(file, fs.constants.X_OK);
        yield fs.realpathSync(file);
      } catch {
        continue;
      }
    }
  }
}

/** Resolve a native executable without searching repository-controlled paths. */
export function findTrustedBinary(
  name: string,
  installDir: string = process.cwd(),
): string | null {
  const extensions = process.platform === 'win32' ? ['.exe', '.com'] : [''];
  const first = trustedBinaries(
    name,
    installDir,
    extensions,
    trustedCommandEnv(installDir),
  ).next();
  return first.done ? null : first.value;
}

export type TrustedCommand = {
  executable: string;
  prefixArgs: string[];
  env: NodeJS.ProcessEnv;
};

function isNodeScript(file: string): boolean {
  const descriptor = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(256);
    const size = fs.readSync(descriptor, header, 0, header.length, 0);
    return /^#!\s*(?:\/usr\/bin\/env\s+)?(?:\S*[/\\])?node(?:\.exe)?\s*(?:\r?\n|$)/.test(
      header.toString('utf8', 0, size),
    );
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Resolve npm shims to their entry points so Windows never needs shell: true. */
export function findTrustedCommand(
  name: string,
  installDir: string = process.cwd(),
): TrustedCommand | null {
  const env = trustedCommandEnv(installDir);
  const windows = process.platform === 'win32';
  const extensions = windows ? ['.exe', '.com', '.cmd'] : [''];
  const allowed = trustPolicy(installDir);
  for (const binary of trustedBinaries(name, installDir, extensions, env)) {
    try {
      let target = binary;
      if (windows && /\.cmd$/i.test(binary)) {
        if (fs.statSync(binary).size > 64 * 1024) continue;
        target = path.resolve(
          path.dirname(binary),
          readCmdShim.sync(binary).replace(/\\/g, path.sep),
        );
        if (!allowed(target) || !fs.statSync(target).isFile()) continue;
        target = fs.realpathSync(target);
        if (/\.(?:exe|com)$/i.test(target)) {
          return { executable: target, prefixArgs: [], env };
        }
        if (/\.[cm]?js$/i.test(target) || isNodeScript(target)) {
          return { executable: process.execPath, prefixArgs: [target], env };
        }
        continue;
      }
      if (isNodeScript(target)) {
        return { executable: process.execPath, prefixArgs: [target], env };
      }
      return { executable: target, prefixArgs: [], env };
    } catch {
      continue;
    }
  }
  return null;
}
