import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  findTrustedBinary,
  findTrustedCommand,
  trustedCommandEnv,
} from '@shared/trusted-command';

describe('trusted native commands', () => {
  let tmp: string;
  let project: string;
  let system: string;
  const platform = process.platform;
  const write = (file: string, contents = '#!/bin/sh\n') => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, { mode: 0o755 });
    return file;
  };
  const setPath = (...directories: string[]) =>
    vi.stubEnv('PATH', directories.join(path.delimiter));
  const windows = () =>
    Object.defineProperty(process, 'platform', { value: 'win32' });

  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-command-')),
    );
    project = path.join(tmp, 'project');
    system = path.join(tmp, 'user tools');
    fs.mkdirSync(project);
    fs.mkdirSync(system);
    vi.spyOn(process, 'cwd').mockReturnValue(project);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('excludes a separate install directory and the launch directory', () => {
    const target = path.join(tmp, 'target');
    const extension = platform === 'win32' ? '.exe' : '';
    write(path.join(target, 'bin', `python${extension}`));
    write(path.join(project, 'bin', `python${extension}`));
    const trusted = write(path.join(system, `python${extension}`));
    setPath(path.join(target, 'bin'), path.join(project, 'bin'), system);
    expect(findTrustedBinary('python', target)).toBe(trusted);
  });

  it.each(['directory', 'worktree file'])(
    'excludes the whole checkout with a .git %s',
    (kind) => {
      if (kind === 'directory') fs.mkdirSync(path.join(project, '.git'));
      else write(path.join(project, '.git'), 'gitdir: /unused/path\n');
      const app = path.join(project, 'packages', 'app');
      fs.mkdirSync(app, { recursive: true });
      vi.mocked(process.cwd).mockReturnValue(app);
      setPath(path.join(project, 'tools'), system);
      const extension = platform === 'win32' ? '.exe' : '';
      write(path.join(project, 'tools', `python${extension}`));
      const trusted = write(path.join(system, `python${extension}`));
      expect(findTrustedBinary('python', app)).toBe(trusted);
    },
  );

  it('filters child PATH without changing the parent or losing user tool order', () => {
    const second = path.join(tmp, 'other tools');
    const bin = path.join(project, 'node_modules', '.bin');
    setPath('', '.', 'relative', bin, system, second);
    const original = process.env.PATH;
    const env = trustedCommandEnv(project);
    expect(env.PATH).toBe([system, second].join(path.delimiter));
    expect(process.env.PATH).toBe(original);
  });

  it.skipIf(platform === 'win32')(
    'rejects symlinked directories and executable targets inside the checkout',
    () => {
      const alias = path.join(tmp, 'alias');
      fs.symlinkSync(project, alias);
      const planted = write(path.join(project, 'python'));
      fs.symlinkSync(planted, path.join(system, 'python'));
      setPath(alias, system);
      expect(findTrustedCommand('python', project)).toBeNull();
      expect(trustedCommandEnv(project).PATH).toBe(system);
    },
  );

  it.skipIf(platform === 'win32')(
    'runs a global Node CLI without invoking a project-local node canary',
    () => {
      const marker = path.join(tmp, 'canary');
      const bin = path.join(project, 'node_modules', '.bin');
      write(path.join(bin, 'node'), `#!/bin/sh\ntouch "${marker}"\n`);
      const script = write(
        path.join(system, 'example'),
        '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n',
      );
      setPath(bin, system, path.dirname(process.execPath));
      const command = findTrustedCommand('example', project);
      if (!command) throw new Error('Expected a trusted command.');
      const args = ['a path with spaces', '$(touch nope)', 'quote"&value'];
      const output = execFileSync(
        command.executable,
        [...command.prefixArgs, ...args],
        {
          cwd: project,
          env: command.env,
          encoding: 'utf8',
        },
      );
      expect(command.prefixArgs).toEqual([script]);
      expect(JSON.parse(output)).toEqual(args);
      expect(fs.existsSync(marker)).toBe(false);
    },
  );

  it('resolves Windows .exe names and normalizes Path casing', () => {
    windows();
    const python = write(path.join(system, 'python.exe'), 'native executable');
    const env = trustedCommandEnv(project, {
      Path: system,
      EXAMPLE: 'preserved',
    });
    expect(env).toMatchObject({
      PATH: system,
      EXAMPLE: 'preserved',
      NoDefaultCurrentDirectoryInExePath: '1',
    });
    expect(env).not.toHaveProperty('Path');
    setPath(system);
    expect(findTrustedBinary('python', project)).toBe(python);
  });

  it.each(['dp0%', '~dp0'])(
    'launches an npm Windows shim using its verified Node entry (%s)',
    (prefix) => {
      windows();
      const script = write(
        path.join(system, 'node_modules', 'example', 'cli.js'),
        '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n',
      );
      write(
        path.join(system, 'example.cmd'),
        `@echo off\r\nnode "%${prefix}\\node_modules\\example\\cli.js" %*\r\n`,
      );
      setPath(system);
      const command = findTrustedCommand('example', project);
      if (!command) throw new Error('Expected a trusted command.');
      expect(command.executable).toBe(process.execPath);
      expect(command.prefixArgs).toEqual([script]);
      const args = ['space here', '%PATH%', 'a&b', 'quote"value'];
      expect(
        JSON.parse(
          execFileSync(command.executable, [...command.prefixArgs, ...args], {
            cwd: project,
            env: command.env,
            encoding: 'utf8',
          }),
        ),
      ).toEqual(args);
    },
  );

  it('rejects a Windows shim whose target is in the project', () => {
    windows();
    write(path.join(project, 'cli.js'), '#!/usr/bin/env node\n');
    write(
      path.join(system, 'example.cmd'),
      '@node "%~dp0\\..\\project\\cli.js" %*\n',
    );
    setPath(system);
    expect(findTrustedCommand('example', project)).toBeNull();
  });

  it('rejects unsupported batch wrappers instead of falling back to a shell', () => {
    windows();
    write(path.join(system, 'example.cmd'), '@echo unexpected wrapper\n');
    setPath(system);
    expect(findTrustedCommand('example', project)).toBeNull();
  });

  it.skipIf(platform !== 'win32')(
    'runs the npm.cmd installed with Node on Windows',
    () => {
      const command = findTrustedCommand('npm', project);
      if (!command) throw new Error('Expected the npm bundled with Node.');
      const version = execFileSync(
        command.executable,
        [...command.prefixArgs, '--version'],
        {
          cwd: project,
          env: command.env,
          encoding: 'utf8',
          timeout: 10000,
        },
      );
      expect(version.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    },
  );
});
