import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('log file writing', () => {
  let tmpRoot: string;

  // The log path is fixed when the module loads, so each test loads it fresh under its own directory.
  const loadWithLogDir = async (dir: string) => {
    vi.stubEnv('POSTHOG_WIZARD_LOG_FILE', path.join(dir, 'posthog-wizard.log'));
    vi.resetModules();
    return import('@utils/debug');
  };

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-debug-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates a missing log directory instead of dropping the log', async () => {
    const dir = path.join(tmpRoot, 'does', 'not', 'exist');
    const { logToFile, getLogFilePath } = await loadWithLogDir(dir);
    const logPath = path.join(dir, 'posthog-wizard.log');
    expect(getLogFilePath()).toBe(logPath);

    logToFile('first line after missing dir');

    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.readFileSync(logPath, 'utf8')).toContain(
      'first line after missing dir',
    );
  });

  it('initLogFile also survives a missing directory', async () => {
    const dir = path.join(tmpRoot, 'nested');
    const { initLogFile } = await loadWithLogDir(dir);

    initLogFile();

    expect(
      fs.readFileSync(path.join(dir, 'posthog-wizard.log'), 'utf8'),
    ).toContain('PostHog Wizard Run:');
  });

  it('never throws when the log path is unwritable even after the mkdir retry', async () => {
    // A file where the parent dir should be defeats the mkdir retry too.
    const blocker = path.join(tmpRoot, 'blocker');
    fs.writeFileSync(blocker, '');
    const { logToFile } = await loadWithLogDir(blocker);

    expect(() => logToFile('goes nowhere')).not.toThrow();
    expect(() => logToFile('still nowhere')).not.toThrow();
  });

  it('keeps writing to an existing directory as before', async () => {
    const { logToFile } = await loadWithLogDir(tmpRoot);

    logToFile('plain write');
    logToFile('second write');

    const content = fs.readFileSync(
      path.join(tmpRoot, 'posthog-wizard.log'),
      'utf8',
    );
    expect(content).toContain('plain write');
    expect(content).toContain('second write');
  });
});
