import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sweepRunInstalledSkills } from '@lib/agent/runner/sequence/orchestrator/orchestrator-runner';

function makeSkill(root: string, id: string, wizardMarked: boolean): string {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# skill');
  if (wizardMarked) fs.writeFileSync(path.join(dir, '.posthog-wizard'), '');
  return dir;
}

describe('sweepRunInstalledSkills', () => {
  let skillsDir: string;

  beforeEach(() => {
    skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-sweep-test-'));
  });

  afterEach(() => fs.rmSync(skillsDir, { recursive: true, force: true }));

  it('removes wizard-marked skills the run installed', () => {
    makeSkill(skillsDir, 'integration-v2-dashboard', true);
    makeSkill(skillsDir, 'build', true);
    sweepRunInstalledSkills(skillsDir, new Set(), undefined);
    expect(fs.readdirSync(skillsDir)).toEqual([]);
  });

  it('keeps the framework reference docs', () => {
    makeSkill(skillsDir, 'integration-django', true);
    makeSkill(skillsDir, 'dashboard', true);
    sweepRunInstalledSkills(skillsDir, new Set(), 'integration-django');
    expect(fs.readdirSync(skillsDir)).toEqual(['integration-django']);
  });

  it('keeps pre-existing skills even when wizard-marked', () => {
    makeSkill(skillsDir, 'revenue-analytics-setup', true);
    makeSkill(skillsDir, 'capture', true);
    sweepRunInstalledSkills(
      skillsDir,
      new Set(['revenue-analytics-setup']),
      undefined,
    );
    expect(fs.readdirSync(skillsDir)).toEqual(['revenue-analytics-setup']);
  });

  it('never touches user-authored skills (no wizard marker)', () => {
    makeSkill(skillsDir, 'my-own-skill', false);
    makeSkill(skillsDir, 'dashboard', true);
    sweepRunInstalledSkills(skillsDir, new Set(), undefined);
    expect(fs.readdirSync(skillsDir)).toEqual(['my-own-skill']);
  });

  it('is a no-op when the skills dir does not exist', () => {
    expect(() =>
      sweepRunInstalledSkills(
        path.join(skillsDir, 'missing'),
        new Set(),
        undefined,
      ),
    ).not.toThrow();
  });
});
