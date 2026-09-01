import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  promoteReferenceSkill,
  sweepRunInstalledSkills,
} from '@lib/agent/runner/sequence/orchestrator/orchestrator-runner';

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

  it('runs after every task, keeping the durable set clean mid-run', () => {
    // Task 1 installs two step skills, then finishes.
    makeSkill(skillsDir, 'integration-v2-dashboard', true);
    makeSkill(skillsDir, 'integration-v2-insight', true);
    sweepRunInstalledSkills(skillsDir, new Set(), 'integration-django');
    expect(fs.readdirSync(skillsDir)).toEqual([]);

    // Task 2 installs the reference docs and one more step skill.
    makeSkill(skillsDir, 'integration-django', true);
    makeSkill(skillsDir, 'integration-v2-build', true);
    sweepRunInstalledSkills(skillsDir, new Set(), 'integration-django');
    expect(fs.readdirSync(skillsDir)).toEqual(['integration-django']);

    // Later sweeps stay idempotent — the surviving docs are never re-judged.
    sweepRunInstalledSkills(skillsDir, new Set(), 'integration-django');
    expect(fs.readdirSync(skillsDir)).toEqual(['integration-django']);
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

describe('promoteReferenceSkill', () => {
  let cacheDir: string;
  let skillsDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-promote-cache-'));
    skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-promote-skills-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(skillsDir, { recursive: true, force: true });
  });

  it('copies only the framework docs pages out of the cache', () => {
    const ref = makeSkill(cacheDir, 'integration-django', true);
    fs.mkdirSync(path.join(ref, 'references'));
    // Real filenames shipped by context-mill integration skills.
    for (const f of [
      '1-begin.md',
      '2-edit.md',
      '3-revise.md',
      '4-conclude.md',
      '3b-enable-products.md',
      'COMMANDMENTS.md',
      'EXAMPLE.md',
      'EXAMPLE-swift.md',
      'EXAMPLE-swift-xcodegen.md',
      'django.md',
      'identify-users.md',
      'nuxt-js-3-6.md',
      'react-router-v6.md',
    ]) {
      fs.writeFileSync(path.join(ref, 'references', f), '# ' + f);
    }

    promoteReferenceSkill(ref, skillsDir, 'integration-django');

    const kept = path.join(skillsDir, 'integration-django');
    expect(fs.readdirSync(path.join(kept, 'references')).sort()).toEqual([
      'django.md',
      'identify-users.md',
      'nuxt-js-3-6.md',
      'react-router-v6.md',
    ]);
    expect(fs.existsSync(path.join(kept, 'SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(kept, '.posthog-wizard'))).toBe(true);
    // Marked and named as the reference, it survives the final sweep.
    sweepRunInstalledSkills(skillsDir, new Set(), 'integration-django');
    expect(fs.readdirSync(skillsDir)).toEqual(['integration-django']);
  });

  it('never clobbers an existing install', () => {
    const ref = makeSkill(cacheDir, 'integration-django', true);
    fs.mkdirSync(path.join(ref, 'references'));
    fs.writeFileSync(path.join(ref, 'references', 'django.md'), '# fresh');
    const existing = makeSkill(skillsDir, 'integration-django', false);

    promoteReferenceSkill(ref, skillsDir, 'integration-django');
    expect(fs.existsSync(path.join(existing, 'references'))).toBe(false);
  });
});
