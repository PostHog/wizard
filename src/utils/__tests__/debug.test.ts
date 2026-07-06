import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
    configureLogFile({ path: originalPath, enabled: true });
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
    // A file where the parent directory should be makes both the append and
    // the mkdir retry fail — the classic worst case for the fallback.
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
});
