import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HostResolution } from '@shared/posthog/host-resolution';
import { resolveSelfDrivingRun } from '../run.js';

describe('self-driving data-only run recipe', () => {
  it('keeps detected-tool prioritisation and cleans only marked setup skills', async () => {
    const installDir = mkdtempSync(join(tmpdir(), 'self-driving-run-'));
    const skillDir = join(
      installDir,
      '.claude',
      'skills',
      'self-driving-setup',
    );
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, '.posthog-wizard'), '');

    try {
      const { run, hooks } = resolveSelfDrivingRun({
        installDir,
        detectedTools: [
          {
            kind: 'Linear',
            label: 'Linear',
            mode: 'deep-link',
            matchedSignal: 'dependency: @linear/sdk',
          },
        ],
      });
      const host = HostResolution.fromApiHost('https://us.posthog.com');
      const credentials = {
        accessToken: 'token',
        projectApiKey: 'phc_test',
        projectId: 123,
        host,
      };

      expect(
        run.customPrompt?.({ projectId: 123, projectApiKey: 'phc_test', host }),
      ).toContain('Linear (source_type: Linear)');
      expect(run.trackStepProgress).toBe(true);
      expect(run.maxQuestions).toBe(13);
      expect(hooks.buildOutroData?.(credentials)?.primaryLink).toEqual({
        label: 'Your Self-driving inbox',
        url: 'https://us.posthog.com/project/123/inbox',
      });

      await hooks.postRun?.(credentials);
      expect(existsSync(skillDir)).toBe(false);
    } finally {
      rmSync(installDir, { recursive: true, force: true });
    }
  });

  it('keeps an unmarked skill directory', async () => {
    const installDir = mkdtempSync(join(tmpdir(), 'self-driving-run-'));
    const skillDir = join(
      installDir,
      '.claude',
      'skills',
      'self-driving-setup',
    );
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'user-owned');

    try {
      const { hooks } = resolveSelfDrivingRun({
        installDir,
        detectedTools: [],
      });
      await hooks.postRun?.({
        accessToken: 'token',
        projectApiKey: 'phc_test',
        projectId: 123,
        host: HostResolution.fromApiHost('https://us.posthog.com'),
      });
      expect(existsSync(skillDir)).toBe(true);
    } finally {
      rmSync(installDir, { recursive: true, force: true });
    }
  });
});
