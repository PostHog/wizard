import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  configureLogFile,
  getLogFilePath,
  getProcessLogTail,
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
    configureLogFile({ path: originalPath, enabled: true, pin: false });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('keeps only whole lines from the last 64K of this process', () => {
    configureLogFile({ path: path.join(tmpRoot, 'w.log'), enabled: true });
    logToFile('first line that must age out');
    for (let i = 0; i < 700; i++) logToFile(`line ${i} ${'x'.repeat(100)}`);
    const tail = getProcessLogTail();
    expect(tail.length).toBeLessThanOrEqual(64 * 1024);
    expect(tail).not.toContain('first line that must age out');
    expect(tail.startsWith('[')).toBe(true);
    expect(tail).toContain('line 699');
  });

  it('leaves out a single line longer than the tail, so no unlabelled secret survives', () => {
    configureLogFile({ path: path.join(tmpRoot, 'w.log'), enabled: true });
    logToFile(`PASSWORD=${'y'.repeat(70 * 1024)}`);
    const tail = getProcessLogTail();
    expect(tail).toContain('log line over 64K left out');
    expect(tail).not.toContain('yyyy');
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
});
