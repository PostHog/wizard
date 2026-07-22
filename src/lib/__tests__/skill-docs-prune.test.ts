import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pruneSkillToDocs } from '@lib/skill-install';

function makeSkillDir(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-prune-test-'));
  for (const f of files) {
    const full = path.join(dir, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '# ' + f);
  }
  return dir;
}

describe('pruneSkillToDocs', () => {
  let dir: string;

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('strips the workflow index and step files, keeps the docs', () => {
    dir = makeSkillDir([
      'SKILL.md',
      '.posthog-wizard',
      'references/1-begin.md',
      'references/2-edit.md',
      'references/3-revise.md',
      'references/4-conclude.md',
      'references/basic-integration-1.0-begin.md',
      'references/EXAMPLE.md',
      'references/COMMANDMENTS.md',
      'references/django.md',
      'references/identify-users.md',
    ]);
    expect(pruneSkillToDocs(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'references')).sort()).toEqual([
      'COMMANDMENTS.md',
      'EXAMPLE.md',
      'django.md',
      'identify-users.md',
    ]);
  });

  it('leaves a non-workflow skill whole (installed by explicit user ask)', () => {
    dir = makeSkillDir([
      'SKILL.md',
      'references/usage.md',
      'references/2fa-setup.md',
    ]);
    expect(pruneSkillToDocs(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'references')).sort()).toEqual([
      '2fa-setup.md',
      'usage.md',
    ]);
  });

  it('is a no-op without a references dir', () => {
    dir = makeSkillDir(['SKILL.md']);
    expect(pruneSkillToDocs(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(true);
  });
});
