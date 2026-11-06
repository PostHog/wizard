import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const deniedPaths = vi.hoisted(() => new Set<string>());

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    appendFileSync: (file: string, data: string) => {
      if (deniedPaths.has(file)) {
        throw Object.assign(new Error(`EACCES: ${file}`), { code: 'EACCES' });
      }
      return actual.appendFileSync(file, data);
    },
  };
});
import {
  configureLogFile,
  getLogFilePath,
  initLogFile,
  logToFile,
} from '@utils/debug';

describe('log file writing', () => {
  const originalPath = getLogFilePath();
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-debug-'));
  });

  afterEach(() => {
    deniedPaths.clear();
    configureLogFile({ path: originalPath, enabled: true, pin: false });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates a missing log directory instead of dropping the log', () => {
    const logPath = path.join(tmpRoot, 'does', 'not', 'exist', 'wizard.log');
    configureLogFile({ path: logPath, enabled: true });

    logToFile('first line after missing dir');

    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.readFileSync(logPath, 'utf8')).toContain(
      'first line after missing dir',
    );
  });

  it('initLogFile also survives a missing directory', () => {
    const logPath = path.join(tmpRoot, 'nested', 'wizard.log');
    configureLogFile({ path: logPath, enabled: true });

    initLogFile();

    expect(fs.readFileSync(logPath, 'utf8')).toContain('PostHog Wizard Run:');
  });

  it('never throws when the log path is unwritable even after the mkdir retry', () => {
    // A file where the parent dir should be defeats the mkdir retry too.
    const blocker = path.join(tmpRoot, 'blocker');
    fs.writeFileSync(blocker, '');
    configureLogFile({ path: path.join(blocker, 'wizard.log'), enabled: true });

    expect(() => logToFile('goes nowhere')).not.toThrow();
    expect(() => logToFile('still nowhere')).not.toThrow();
  });

  it('keeps writing to an existing directory as before', () => {
    const logPath = path.join(tmpRoot, 'wizard.log');
    configureLogFile({ path: logPath, enabled: true });

    logToFile('plain write');
    logToFile('second write');

    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toContain('plain write');
    expect(content).toContain('second write');
  });

  it('keeps a pinned --log-file path when a later caller sets another', () => {
    const explicit = path.join(tmpRoot, 'explicit.log');
    configureLogFile({ path: explicit, pin: true });
    configureLogFile({ path: path.join(tmpRoot, 'benchmark.log') });

    expect(getLogFilePath()).toBe(explicit);
  });

  it.skipIf(process.platform === 'win32')(
    'falls back to a per-user log when another user owns the shared log',
    () => {
      const shared = path.join(tmpRoot, 'posthog-wizard.log');
      const perUser = path.join(
        tmpRoot,
        `posthog-wizard-${String(process.getuid?.())}.log`,
      );
      deniedPaths.add(shared);
      configureLogFile({ path: shared, enabled: true });

      logToFile('first line');
      logToFile('second line');

      expect(getLogFilePath()).toBe(perUser);
      const content = fs.readFileSync(perUser, 'utf8');
      expect(content).toContain('first line');
      expect(content).toContain('second line');
    },
  );

  it('keeps a pinned --log-file path when it is not writable', () => {
    const explicit = path.join(tmpRoot, 'explicit.log');
    deniedPaths.add(explicit);
    configureLogFile({ path: explicit, enabled: true, pin: true });

    expect(() => logToFile('goes nowhere')).not.toThrow();
    expect(getLogFilePath()).toBe(explicit);
  });
});
