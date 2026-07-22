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

  it('keeps only the framework docs pages of a workflow skill', () => {
    dir = makeSkillDir([
      'SKILL.md',
      'references/1-begin.md',
      'references/basic-integration-1.0-begin.md',
      'references/EXAMPLE.md',
      'references/COMMANDMENTS.md',
      'references/django.md',
      'references/identify-users.md',
    ]);
    pruneSkillToDocs(dir);
    expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'references')).sort()).toEqual([
      'django.md',
      'identify-users.md',
    ]);
  });

  it('leaves a docs-only skill whole (installed by explicit user ask)', () => {
    dir = makeSkillDir(['SKILL.md', 'references/usage.md']);
    pruneSkillToDocs(dir);
    expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'references'))).toEqual(['usage.md']);
  });
});
