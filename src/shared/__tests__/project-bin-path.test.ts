import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { withoutProjectBins } from '@shared/project-bin-path';

const join = (...entries: string[]) => entries.join(path.delimiter);

describe('withoutProjectBins', () => {
  const root = path.resolve('/project');
  const bin = path.join(root, 'node_modules', '.bin');
  const system = path.resolve('/usr/bin');

  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes the bin folders npx adds and keeps the rest in order', () => {
    const other = path.resolve('/opt/tools');
    const web = path.join(root, 'apps', 'web');
    expect(
      withoutProjectBins(
        join(
          path.join(web, 'node_modules', '.bin'),
          path.join(root, 'apps', 'node_modules', '.bin'),
          bin,
          path.resolve('/node_modules/.bin'),
          system,
          other,
        ),
        web,
      ),
    ).toBe(join(system, other));
  });

  it('keeps package managers and global tools in other node_modules/.bin folders', () => {
    const setupPnpm = path.resolve('/home/runner/setup-pnpm/node_modules/.bin');
    const yarnGlobal = path.resolve(
      '/home/me/.config/yarn/global/node_modules/.bin',
    );
    const npxCache = path.resolve('/home/me/.npm/_npx/abc/node_modules/.bin');
    const entries = join(setupPnpm, yarnGlobal, npxCache, system);
    expect(
      withoutProjectBins(entries, path.resolve('/home/runner/work/app')),
    ).toBe(entries);
  });

  it('keeps a bin folder inside a sibling project', () => {
    const sibling = path.join(root, 'tools', 'node_modules', '.bin');
    expect(withoutProjectBins(join(sibling, system))).toBe(
      join(sibling, system),
    );
  });

  it.skipIf(process.platform === 'win32')(
    'finds pnpm in another bin folder and skips a planted copy',
    () => {
      const tmp = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'project-bin-path-')),
      );
      try {
        const project = path.join(tmp, 'work', 'app');
        const planted = path.join(project, 'node_modules', '.bin');
        const setupPnpm = path.join(tmp, 'setup-pnpm', 'node_modules', '.bin');
        fs.mkdirSync(planted, { recursive: true });
        fs.mkdirSync(setupPnpm, { recursive: true });
        fs.writeFileSync(
          path.join(planted, 'pnpm'),
          '#!/bin/sh\necho planted\n',
          {
            mode: 0o755,
          },
        );
        fs.writeFileSync(
          path.join(setupPnpm, 'pnpm'),
          '#!/bin/sh\necho setup-pnpm\n',
          { mode: 0o755 },
        );
        const env = {
          ...process.env,
          PATH: withoutProjectBins(
            join(planted, setupPnpm, '/usr/bin', '/bin'),
            project,
          ),
        };

        expect(
          execFileSync('pnpm', { cwd: project, env, encoding: 'utf8' }).trim(),
        ).toBe('setup-pnpm');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'removes a project bin folder reached through a symlink',
    () => {
      const tmp = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'project-bin-path-')),
      );
      try {
        const project = path.join(tmp, 'app');
        const planted = path.join(project, 'node_modules', '.bin');
        fs.mkdirSync(planted, { recursive: true });
        const alias = path.join(tmp, 'alias');
        fs.symlinkSync(project, alias);
        const viaAlias = path.join(alias, 'node_modules', '.bin');

        expect(withoutProjectBins(join(viaAlias, system), project)).toBe(
          system,
        );
        expect(withoutProjectBins(join(planted, system), alias)).toBe(system);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it('removes empty and relative entries, which search the working directory', () => {
    expect(withoutProjectBins(join('', '.', 'tools', system))).toBe(system);
  });

  it('keeps folders that only resemble node_modules/.bin', () => {
    const similar = path.join(root, 'node_modules', '.binaries');
    const nested = path.join(root, 'node_modules', 'pkg', 'bin');
    expect(withoutProjectBins(join(similar, nested))).toBe(
      join(similar, nested),
    );
  });

  it('on Windows, keeps a quoted absolute entry and removes a quoted project bin', () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const quoted = `"${system}"`;
      expect(withoutProjectBins(join(`"${bin}"`, quoted))).toBe(quoted);
    } finally {
      Object.defineProperty(process, 'platform', { value: platform });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'removes quoted entries, which Unix reads as relative folder names',
    () => {
      expect(withoutProjectBins(join(`"${system}"`, '/bin'))).toBe('/bin');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'does not run a file from a folder named like a quoted PATH entry',
    () => {
      const tmp = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'project-bin-path-')),
      );
      try {
        const marker = path.join(tmp, 'canary');
        const folder = path.join(tmp, '"', 'usr', 'bin"');
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(
          path.join(folder, 'wizard-test-tool'),
          `#!/bin/sh\ntouch "${marker}"\n`,
          { mode: 0o755 },
        );
        const env = {
          ...process.env,
          PATH: withoutProjectBins(join('"/usr/bin"', '/bin')),
        };

        spawnSync('wizard-test-tool', { cwd: tmp, env });
        spawnSync('wizard-test-tool', { cwd: tmp, env, shell: true });

        expect(fs.existsSync(marker)).toBe(false);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'falls back to the system folders when nothing is left',
    () => {
      expect(withoutProjectBins('')).toBe('/usr/bin:/bin');
      expect(withoutProjectBins(bin)).toBe('/usr/bin:/bin');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'never leaves a PATH that searches the working directory',
    () => {
      const tmp = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'project-bin-path-')),
      );
      try {
        const marker = path.join(tmp, 'canary');
        fs.writeFileSync(
          path.join(tmp, 'wizard-test-tool'),
          `#!/bin/sh\ntouch "${marker}"\n`,
          { mode: 0o755 },
        );
        const env = { ...process.env, PATH: withoutProjectBins(bin) };

        spawnSync('wizard-test-tool', { cwd: tmp, env });
        spawnSync('wizard-test-tool', { cwd: tmp, env, shell: true });

        expect(fs.existsSync(marker)).toBe(false);
        expect(spawnSync('ls', ['/'], { env }).status).toBe(0);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'runs the installed command, not one planted in the project',
    () => {
      const tmp = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'project-bin-path-')),
      );
      try {
        const marker = path.join(tmp, 'canary');
        const planted = path.join(tmp, 'project', 'node_modules', '.bin');
        const installed = path.join(tmp, 'installed');
        fs.mkdirSync(planted, { recursive: true });
        fs.mkdirSync(installed);
        fs.writeFileSync(
          path.join(planted, 'security'),
          `#!/bin/sh\ntouch "${marker}"\necho planted\n`,
          { mode: 0o755 },
        );
        fs.writeFileSync(
          path.join(installed, 'security'),
          '#!/bin/sh\necho installed\n',
          { mode: 0o755 },
        );
        const env = {
          ...process.env,
          PATH: withoutProjectBins(
            join(planted, installed, '/usr/bin', '/bin'),
            path.join(tmp, 'project'),
          ),
        };

        expect(execFileSync('security', { env, encoding: 'utf8' }).trim()).toBe(
          'installed',
        );
        expect(
          spawnSync('security', {
            env,
            encoding: 'utf8',
            shell: true,
          }).stdout.trim(),
        ).toBe('installed');
        expect(fs.existsSync(marker)).toBe(false);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  );
});
