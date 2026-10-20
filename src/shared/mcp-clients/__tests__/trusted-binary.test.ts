import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findTrustedBinary } from '@shared/mcp-clients/trusted-binary';

vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('os')>()),
  homedir: vi.fn(),
}));

describe('findTrustedBinary', () => {
  let tmp: string;
  let home: string;
  let project: string;
  let system: string;

  const executable = (dir: string, name = 'codex') => {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, '#!/bin/sh\n', { mode: 0o755 });
    return file;
  };
  const setPath = (...dirs: string[]) =>
    vi.stubEnv('PATH', dirs.join(path.delimiter));

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bin-')));
    home = path.join(tmp, 'home');
    project = path.join(home, 'code', 'repo');
    system = path.join(tmp, 'usr', 'local', 'bin');
    fs.mkdirSync(project, { recursive: true });
    vi.mocked(os.homedir).mockReturnValue(home);
    vi.spyOn(process, 'cwd').mockReturnValue(project);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the real path of an executable on PATH', () => {
    const codex = executable(system);
    setPath(system);
    expect(findTrustedBinary('codex')).toBe(codex);
  });

  it("skips a copy in the project's node_modules/.bin and finds the next one", () => {
    executable(path.join(project, 'node_modules', '.bin'));
    const codex = executable(system);
    setPath(path.join(project, 'node_modules', '.bin'), system);
    expect(findTrustedBinary('codex')).toBe(codex);
  });

  it('skips a node_modules/.bin above the project too', () => {
    executable(path.join(home, 'code', 'node_modules', '.bin'));
    setPath(path.join(home, 'code', 'node_modules', '.bin'));
    expect(findTrustedBinary('codex')).toBeNull();
  });

  it('skips a symlink whose target is inside the project', () => {
    const planted = executable(path.join(project, 'scripts'), 'evil.sh');
    const linkDir = path.join(tmp, 'opt', 'bin');
    fs.mkdirSync(linkDir, { recursive: true });
    fs.symlinkSync(planted, path.join(linkDir, 'codex'));
    setPath(linkDir);
    expect(findTrustedBinary('codex')).toBeNull();
  });

  it('skips relative PATH entries, which resolve inside the project', () => {
    executable(path.join(project, 'bin'));
    setPath('bin', '.');
    expect(findTrustedBinary('codex')).toBeNull();
  });

  it('skips files that are not executable', () => {
    fs.mkdirSync(system, { recursive: true });
    fs.writeFileSync(path.join(system, 'codex'), '', { mode: 0o644 });
    setPath(system);
    expect(findTrustedBinary('codex')).toBeNull();
  });

  it('trusts tools under the home folder when run from the home folder', () => {
    vi.mocked(process.cwd).mockReturnValue(home);
    const codex = executable(path.join(home, '.local', 'bin'));
    setPath(path.join(home, '.local', 'bin'));
    expect(findTrustedBinary('codex')).toBe(codex);
  });
});
