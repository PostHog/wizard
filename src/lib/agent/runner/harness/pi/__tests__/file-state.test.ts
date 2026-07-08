import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFileReadTracker } from '../file-state';

const NOT_READ = /File has not been read yet/;
const MODIFIED = /File has been modified since read/;

// Bump a file's mtime past whatever the tracker observed. utimes with an
// explicit future-ish stamp — a rewrite alone can land within mtime
// granularity on fast filesystems.
function touchLater(file: string): void {
  const later = new Date(fs.statSync(file).mtimeMs + 2000);
  fs.utimesSync(file, later, later);
}

describe('createFileReadTracker — claude-agent-sdk read-before-write parity', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-file-state-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('allows creating a brand-new file without any prior read', () => {
    const tracker = createFileReadTracker(dir);
    expect(tracker.gate('brand-new.ts')).toBeUndefined();
  });

  it('blocks mutating an existing file that was never read', () => {
    fs.writeFileSync(path.join(dir, 'app.ts'), 'export {};');
    const tracker = createFileReadTracker(dir);
    expect(tracker.gate('app.ts')).toMatch(NOT_READ);
  });

  it('allows mutating after a read', () => {
    fs.writeFileSync(path.join(dir, 'app.ts'), 'export {};');
    const tracker = createFileReadTracker(dir);
    tracker.noteRead('app.ts');
    expect(tracker.gate('app.ts')).toBeUndefined();
  });

  it('blocks again when the file changed after the read (linter, install script)', () => {
    const file = path.join(dir, 'app.ts');
    fs.writeFileSync(file, 'export {};');
    const tracker = createFileReadTracker(dir);
    tracker.noteRead('app.ts');
    touchLater(file);
    expect(tracker.gate('app.ts')).toMatch(MODIFIED);
  });

  it("the agent's own mutation counts as knowing the content", () => {
    const file = path.join(dir, 'app.ts');
    const tracker = createFileReadTracker(dir);
    // write creates the file (gate passed as brand-new), result recorded:
    fs.writeFileSync(file, 'v1');
    tracker.noteMutation('app.ts');
    // an immediate follow-up edit needs no fresh read
    expect(tracker.gate('app.ts')).toBeUndefined();
  });

  it('resolves relative paths against the working directory, accepts absolute', () => {
    const file = path.join(dir, 'nested', 'app.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export {};');
    const tracker = createFileReadTracker(dir);
    tracker.noteRead('nested/app.ts');
    expect(tracker.gate(file)).toBeUndefined();
  });

  it('fails open on unreadable paths (the tool surfaces the real error)', () => {
    const tracker = createFileReadTracker(dir);
    expect(tracker.gate('\0invalid')).toBeUndefined();
  });
});
