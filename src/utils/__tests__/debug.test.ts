import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  configureLogFile,
  getLogFilePath,
  initLogFile,
  logToFile,
  MAX_LOG_FILE_BYTES,
  MAX_LOG_LINE_BYTES,
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

  it('caps a single log write at 8 KB', () => {
    const logPath = path.join(tmpRoot, 'capped-line.log');
    configureLogFile({ path: logPath, enabled: true });

    logToFile('x'.repeat(100_000));

    const written = fs.readFileSync(logPath, 'utf8');
    expect(Buffer.byteLength(written, 'utf8')).toBeLessThanOrEqual(
      MAX_LOG_LINE_BYTES,
    );
    expect(written).toContain('[truncated');
  });

  it('stops appending once the log file reaches 10 MB', () => {
    const logPath = path.join(tmpRoot, 'capped-file.log');
    // Tiny headroom so a normal log line forces the file-cap path.
    const seedSize = MAX_LOG_FILE_BYTES - 16;
    fs.writeFileSync(logPath, 'y'.repeat(seedSize));
    configureLogFile({ path: logPath, enabled: true });

    logToFile('x'.repeat(1000));
    const sizeAfterFirst = fs.statSync(logPath).size;
    expect(sizeAfterFirst).toBeLessThanOrEqual(MAX_LOG_FILE_BYTES);
    expect(sizeAfterFirst).toBeGreaterThan(seedSize);

    logToFile('should-not-grow');
    expect(fs.statSync(logPath).size).toBe(sizeAfterFirst);
    expect(fs.readFileSync(logPath, 'utf8')).not.toContain('should-not-grow');
  });
});
