import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HostResolution } from '@shared/host-resolution';
import { resolveSelfDrivingRun } from '../run.js';

const credentials = {
  accessToken: 'token',
  projectApiKey: 'phc_test',
  projectId: 123,
  host: HostResolution.fromApiHost('https://us.posthog.com'),
};

it.each([
  ['removes a marked', '.posthog-wizard', false],
  ['keeps an unmarked', 'SKILL.md', true],
])(
  '%s setup skill after the run and links the inbox',
  async (_label, file, kept) => {
    const installDir = mkdtempSync(join(tmpdir(), 'self-driving-run-'));
    const skillDir = join(
      installDir,
      '.claude',
      'skills',
      'self-driving-setup',
    );
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, file), '');
    try {
      const { hooks } = resolveSelfDrivingRun({
        installDir,
        detectedTools: [],
      });

      expect(hooks.buildOutroData?.(credentials)?.primaryLink?.url).toBe(
        'https://us.posthog.com/project/123/inbox',
      );
      await hooks.postRun?.(credentials);
      expect(existsSync(skillDir)).toBe(kept);
    } finally {
      rmSync(installDir, { recursive: true, force: true });
    }
  },
);
