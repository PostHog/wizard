import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getPythonVersion } from '../utils';

describe('Python version executable trust', () => {
  let tmp: string;
  let project: string;
  let system: string;
  let marker: string;
  const script = (directory: string, name: string, body: string) => {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, name);
    fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
    if (process.platform === 'win32') {
      fs.writeFileSync(`${file}.cmd`, `@node "%~dp0\\${name}" %*\r\n`);
    }
  };

  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'python-trust-')),
    );
    project = path.join(tmp, 'project');
    system = path.join(tmp, 'installed tools');
    marker = path.join(tmp, 'canary');
    fs.mkdirSync(project);
    fs.mkdirSync(system);
    fs.writeFileSync(path.join(project, 'requirements.txt'), '');
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    const bin = path.join(project, 'node_modules', '.bin');
    script(
      bin,
      'python',
      `require('fs').writeFileSync(${JSON.stringify(
        marker,
      )}, 'ran'); console.log('Python 3.12.0');`,
    );
    vi.stubEnv('PATH', [bin, system].join(path.delimiter));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('skips repository Python and uses an installed interpreter', () => {
    script(system, 'python', "console.log('Python 3.12.4');");
    expect(
      getPythonVersion({
        installDir: project,
        ci: false,
        debug: false,
        benchmark: false,
        yaraReport: false,
        signup: false,
      }),
    ).toBe('3.12.4');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('falls back to trusted python3 when python fails', () => {
    script(system, 'python', 'process.exit(1);');
    script(system, 'python3', "console.log('Python 3.11.9');");
    expect(
      getPythonVersion({
        installDir: project,
        ci: false,
        debug: false,
        benchmark: false,
        yaraReport: false,
        signup: false,
      }),
    ).toBe('3.11.9');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('leaves the version unknown rather than executing the repository copy', () => {
    expect(
      getPythonVersion({
        installDir: project,
        ci: false,
        debug: false,
        benchmark: false,
        yaraReport: false,
        signup: false,
      }),
    ).toBeUndefined();
    expect(fs.existsSync(marker)).toBe(false);
  });
});
