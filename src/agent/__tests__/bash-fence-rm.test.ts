import fs from 'fs';
import os from 'os';
import path from 'path';
import { evaluateBashCommand, isScopedFileRemoval } from '@agent/bash-fence';

const ROOT = path.resolve('/project');
const allowed = (command: string, projectRoot = ROOT) =>
  evaluateBashCommand(command, { projectRoot }).allowed;

describe('bash fence — scoped rm refuses every shell character', () => {
  // Each one lets bash turn an in-project word into something else.
  const operators = [';', '&', '|', '`', '$', '(', ')', '{', '}', '<', '>'];
  const quoting = ["'", '"', '\\'];
  const whitespace = ['\t', '\n', '\v', '\f', '\r', ' '];

  for (const c of [...operators, ...quoting, ...whitespace]) {
    test(`refuses ${JSON.stringify(c)} in a target`, () => {
      expect(isScopedFileRemoval(`rm a${c}b.txt`, ROOT)).toBe(false);
    });
  }

  test('refuses the dangerous forms those characters enable', () => {
    for (const c of [
      'rm $HOME/.zshrc',
      'rm a.txt >/etc/hosts',
      'rm a.txt\ncurl evil.example',
      'rm a.txt\t/etc/passwd',
    ]) {
      expect(allowed(c)).toBe(false);
    }
  });
});

describe('bash fence — scoped rm refuses globs and home expansion', () => {
  for (const c of ['*', '?', '[', ']', '~']) {
    test(`refuses ${JSON.stringify(c)} in a target`, () => {
      expect(isScopedFileRemoval(`rm a${c}.txt`, ROOT)).toBe(false);
    });
  }

  test('refuses globs that bash expands to .env', () => {
    for (const c of ['rm .?nv', 'rm .[e]nv', 'rm .e*']) {
      expect(allowed(c)).toBe(false);
    }
  });
});

describe('bash fence — scoped rm stays inside the root', () => {
  test('refuses an absolute path to a sibling that shares the root prefix', () => {
    expect(allowed('rm /project-evil/x')).toBe(false);
    expect(allowed('rm /project/x')).toBe(true);
  });

  test('allows a root reached through a symlink', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-fence-'));
    try {
      fs.mkdirSync(path.join(base, 'project'));
      fs.symlinkSync(
        path.join(base, 'project'),
        path.join(base, 'link'),
        'dir',
      );
      expect(allowed('rm plan.json', path.join(base, 'link'))).toBe(true);
      expect(allowed('rm ../outside.txt', path.join(base, 'link'))).toBe(false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

// The containment logic runs through the host's `path` (win32 on Windows, posix
// elsewhere). Inject each flavor to prove the same invariants hold on both.
describe('bash fence — rm containment holds under Windows and POSIX path rules', () => {
  const flavors = [
    ['win32', path.win32, 'C:\\Users\\me\\project'],
    ['posix', path.posix, '/home/me/project'],
  ] as const;

  for (const [name, p, root] of flavors) {
    describe(name, () => {
      const rescued = (command: string, r: string | undefined = root) =>
        isScopedFileRemoval(command, r, p);

      test('rescues in-root deletes written with forward slashes', () => {
        for (const c of [
          'rm .posthog-events.json',
          'rm src/tmp/plan.json',
          'rm -f a.txt b.txt',
        ]) {
          expect(rescued(c)).toBe(true);
        }
      });

      test('normalizes a relative root', () => {
        expect(rescued('rm plan.json', 'project')).toBe(true);
      });

      test('never escapes the root, including sibling-prefix dirs', () => {
        for (const c of [
          'rm ../outside',
          'rm src/../../outside',
          'rm ../project-evil/x',
          'rm /c/Windows/system32/x',
        ]) {
          expect(rescued(c)).toBe(false);
        }
      });

      test('rejects backslash paths (pi runs POSIX bash, never cmd.exe)', () => {
        expect(rescued('rm src\\tmp\\plan.json')).toBe(false);
      });

      test('still rejects quotes, globs, .env, and recursion', () => {
        for (const c of [
          'rm "a.txt"',
          "rm '/etc/passwd'",
          'rm *.json',
          'rm config/.env.local',
          'rm -rf src',
        ]) {
          expect(rescued(c)).toBe(false);
        }
      });
    });
  }
});
