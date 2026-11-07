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

  it('removes node_modules/.bin folders and keeps the rest in order', () => {
    const other = path.resolve('/opt/tools');
    expect(
      withoutProjectBins(
        join(
          bin,
          system,
          path.join(root, 'apps', 'web', 'node_modules', '.bin'),
          other,
        ),
      ),
    ).toBe(join(system, other));
  });

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
