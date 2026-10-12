import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  normalizeGitRemote,
  workspaceFingerprint,
} from '@programs/codebase-scan/fingerprint';

describe('normalizeGitRemote', () => {
  it.each([
    ['git@github.com:PostHog/wizard.git', 'github.com/posthog/wizard'],
    ['https://github.com/PostHog/wizard.git', 'github.com/posthog/wizard'],
    [
      'https://user:token@github.com/PostHog/wizard',
      'github.com/posthog/wizard',
    ],
    ['ssh://git@github.com:22/PostHog/wizard.git', 'github.com/posthog/wizard'],
    [
      'https://gitlab.example.com/group/sub/app/',
      'gitlab.example.com/group/sub/app',
    ],
  ])('%s → %s', (remote, expected) => {
    expect(normalizeGitRemote(remote)).toBe(expected);
  });
});

describe('workspaceFingerprint', () => {
  /** A repository whose root is the given dir, as a clone of `remote`. */
  const clonedAt = (remote: string) => (dir: string) => ({ remote, root: dir });

  it('matches across remote spellings of one repo, and differs per project', () => {
    const ssh = workspaceFingerprint(
      1,
      '/a',
      clonedAt('git@github.com:PostHog/wizard.git'),
    );
    const https = workspaceFingerprint(
      1,
      '/b',
      clonedAt('https://github.com/posthog/wizard'),
    );
    const otherProject = workspaceFingerprint(
      2,
      '/a',
      clonedAt('git@github.com:PostHog/wizard.git'),
    );

    expect(ssh).toBe(https);
    expect(ssh).not.toBe(otherProject);
  });

  describe('in a repository on disk', () => {
    let repo: string;

    beforeEach(() => {
      repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fingerprint-'));
      fs.mkdirSync(path.join(repo, '.git'));
      fs.writeFileSync(
        path.join(repo, '.git', 'config'),
        '[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@github.com:other/fork.git\n[remote "origin"]\n\turl = git@github.com:PostHog/wizard.git\n',
      );
      fs.mkdirSync(path.join(repo, 'apps', 'web'), { recursive: true });
      fs.mkdirSync(path.join(repo, 'apps', 'api'), { recursive: true });
    });
    afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    it('reads origin and the root from the repository config', () => {
      expect(workspaceFingerprint(1, path.join(repo, 'apps', 'web'))).toBe(
        workspaceFingerprint(1, '/elsewhere/apps/web', () => ({
          remote: 'github.com/posthog/wizard',
          root: '/elsewhere',
        })),
      );
    });

    it('gives each app in a monorepo its own fingerprint', () => {
      const web = workspaceFingerprint(1, path.join(repo, 'apps', 'web'));
      const api = workspaceFingerprint(1, path.join(repo, 'apps', 'api'));

      expect(web).not.toBe(api);
      expect(workspaceFingerprint(1, path.join(repo, 'apps', 'web'))).toBe(web);
      expect(web).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
