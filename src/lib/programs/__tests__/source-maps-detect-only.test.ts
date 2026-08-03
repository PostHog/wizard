import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import {
  DETECTION_KIND,
  resolveRepository,
  toDetectionPayload,
} from '@lib/programs/error-tracking-upload-source-maps/detect-only';
import type { DetectionReport } from '@lib/programs/error-tracking-upload-source-maps/detect-agentic';

describe('source-maps detect-only', () => {
  it('maps the in-process report onto the snake_case API contract', () => {
    const report: DetectionReport = {
      repoType: 'monorepo',
      projects: [
        {
          path: 'apps/web',
          framework: 'Next.js',
          variant: 'nextjs',
          hasPostHog: true,
          instrumentable: true,
        },
        {
          path: 'apps/mobile',
          framework: 'React Native',
          variant: null,
          hasPostHog: false,
          instrumentable: false,
          reason: 'not supported',
        },
      ],
    };

    expect(toDetectionPayload('acme/shop', report)).toEqual({
      repository: 'acme/shop',
      kind: DETECTION_KIND,
      report: {
        repo_type: 'monorepo',
        projects: [
          {
            path: 'apps/web',
            framework: 'Next.js',
            variant: 'nextjs',
            has_posthog: true,
            instrumentable: true,
          },
          {
            path: 'apps/mobile',
            framework: 'React Native',
            variant: null,
            has_posthog: false,
            instrumentable: false,
            reason: 'not supported',
          },
        ],
      },
    });
  });

  it.each([
    ['acme/shop', 'acme/shop'],
    ['acme-corp/my.app', 'acme-corp/my.app'],
    ['not a repo', null],
    ['https://github.com/acme/shop', null],
  ])('validates the explicit --repository value %s', (explicit, expected) => {
    expect(resolveRepository(explicit, os.tmpdir())).toBe(expected);
  });

  it('falls back to the git origin remote of the install dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-only-'));
    try {
      execSync('git init --quiet', { cwd: dir });
      execSync('git remote add origin git@github.com:acme-corp/my-app.git', {
        cwd: dir,
      });
      expect(resolveRepository(undefined, dir)).toBe('acme-corp/my-app');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves null when there is no remote to fall back to', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-only-'));
    try {
      expect(resolveRepository(undefined, dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
