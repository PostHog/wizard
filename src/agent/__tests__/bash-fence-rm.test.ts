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
