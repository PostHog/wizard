import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import {
  DETECTION_KIND,
  postDetection,
  resolveRepository,
  toDetectionPayload,
} from '@lib/programs/error-tracking-upload-source-maps/detect-only';
import type { DetectionReport } from '@lib/programs/error-tracking-upload-source-maps/detect-agentic';
import type { Credentials } from '@lib/wizard-session';

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

describe('postDetection', () => {
  const creds = {
    accessToken: 'token',
    projectId: 1,
    host: { apiHost: 'https://us.posthog.com/' },
  } as unknown as Credentials;
  const payload = { repository: 'acme/shop', kind: DETECTION_KIND };
  const noSleep = () => Promise.resolve();

  const respond = (status: number) => new Response('{}', { status });

  it('retries transient failures and succeeds', async () => {
    const attempts = [
      () => Promise.reject(new Error('socket hang up')),
      () => Promise.resolve(respond(429)),
      () => Promise.resolve(respond(200)),
    ];
    const urls: string[] = [];
    const fetchImpl = ((url: string) => {
      urls.push(url);
      return attempts.shift()!();
    }) as unknown as typeof fetch;

    await expect(
      postDetection(creds, payload, { fetchImpl, sleepImpl: noSleep }),
    ).resolves.toBeUndefined();
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe(
      'https://us.posthog.com/api/projects/1/wizard/repository_detections/',
    );
  });

  it('fails fast on non-retriable 4xx responses', async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(respond(400));
    }) as unknown as typeof fetch;

    await expect(
      postDetection(creds, payload, { fetchImpl, sleepImpl: noSleep }),
    ).rejects.toThrow('HTTP 400');
    expect(calls).toBe(1);
  });

  it('gives up after the retry budget is exhausted', async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(respond(502));
    }) as unknown as typeof fetch;

    await expect(
      postDetection(creds, payload, { fetchImpl, sleepImpl: noSleep }),
    ).rejects.toThrow('HTTP 502');
    expect(calls).toBe(3);
  });
});
