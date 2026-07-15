import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_UPLOAD_CHECKS,
  parseRepositoryFromGitRemote,
  uploadSetupReview,
} from '../audit/setup-review';
import { AUDIT_CHECKS_FILE, type AuditCheck } from '../audit/types';
import { buildSession } from '../../wizard-session';
import type { Credentials } from '../../wizard-session';
import { HostResolution } from '../../host-resolution';

const CREDS: Credentials = {
  host: HostResolution.fromApiHost('https://us.posthog.com'),
  projectId: 42,
  accessToken: 'pha_abc',
  projectApiKey: 'phc_test',
};

const CHECKS: AuditCheck[] = [
  {
    id: 'identify-stable-distinct-id',
    area: 'identify',
    label: 'Stable distinct id',
    status: 'error',
    file: 'src/auth.ts',
    details: 'distinct_id changes per session',
  },
  { id: 'init-correct', area: 'setup', label: 'Init correct', status: 'pass' },
];

let dir: string;

function initGitRepo(remoteUrl?: string): void {
  childProcess.execSync('git init -q', { cwd: dir });
  if (remoteUrl) {
    childProcess.execSync(`git remote add origin ${remoteUrl}`, { cwd: dir });
  }
}

function writeLedger(checks: unknown): void {
  fs.writeFileSync(path.join(dir, AUDIT_CHECKS_FILE), JSON.stringify(checks));
}

function makeFetch(status = 202) {
  return vi.fn(() => Promise.resolve(new Response('', { status })));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-review-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('parseRepositoryFromGitRemote', () => {
  it.each([
    ['git@github.com:acme/my-app.git', 'acme/my-app'],
    ['https://github.com/acme/my-app.git', 'acme/my-app'],
    ['https://github.com/acme/my-app', 'acme/my-app'],
  ])('parses %s', (remote, expected) => {
    initGitRepo(remote);
    expect(parseRepositoryFromGitRemote(dir)).toBe(expected);
  });

  it('returns null without a git repo or without an origin remote', () => {
    expect(parseRepositoryFromGitRemote(dir)).toBeNull();
    initGitRepo();
    expect(parseRepositoryFromGitRemote(dir)).toBeNull();
  });
});

describe('uploadSetupReview', () => {
  it('POSTs repository + ledger checks with bearer auth', async () => {
    initGitRepo('git@github.com:acme/my-app.git');
    writeLedger(CHECKS);
    const fetchImpl = makeFetch();

    await uploadSetupReview(
      buildSession({ installDir: dir }),
      CREDS,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      NonNullable<Parameters<typeof fetch>[1]>,
    ];
    expect(url).toBe(
      'https://us.posthog.com/api/projects/42/wizard/sessions/setup_review/',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer pha_abc',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      repository: 'acme/my-app',
      checks: CHECKS,
    });
  });

  it('caps the uploaded ledger at MAX_UPLOAD_CHECKS entries', async () => {
    initGitRepo('git@github.com:acme/my-app.git');
    writeLedger(
      Array.from({ length: MAX_UPLOAD_CHECKS + 10 }, (_, i) => ({
        ...CHECKS[0],
        id: `check-${i}`,
      })),
    );
    const fetchImpl = makeFetch();

    await uploadSetupReview(
      buildSession({ installDir: dir }),
      CREDS,
      fetchImpl,
    );

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      NonNullable<Parameters<typeof fetch>[1]>,
    ];
    expect(JSON.parse(init.body as string).checks).toHaveLength(
      MAX_UPLOAD_CHECKS,
    );
  });

  it.each([
    ['ci runs', () => buildSession({ installDir: dir, ci: true }), true, true],
    ['no origin remote', () => buildSession({ installDir: dir }), false, true],
    ['no ledger on disk', () => buildSession({ installDir: dir }), true, false],
  ])(
    'skips upload for %s',
    async (_name, makeSession, withRemote, withLedger) => {
      if (withRemote) initGitRepo('git@github.com:acme/my-app.git');
      else initGitRepo();
      if (withLedger) writeLedger(CHECKS);
      const fetchImpl = makeFetch();

      await uploadSetupReview(makeSession(), CREDS, fetchImpl);

      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('skips upload for an empty or malformed ledger', async () => {
    initGitRepo('git@github.com:acme/my-app.git');
    const fetchImpl = makeFetch();

    writeLedger([]);
    await uploadSetupReview(
      buildSession({ installDir: dir }),
      CREDS,
      fetchImpl,
    );
    fs.writeFileSync(path.join(dir, AUDIT_CHECKS_FILE), 'not json');
    await uploadSetupReview(
      buildSession({ installDir: dir }),
      CREDS,
      fetchImpl,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws when the request fails', async () => {
    initGitRepo('git@github.com:acme/my-app.git');
    writeLedger(CHECKS);
    const fetchImpl = vi.fn(() => Promise.reject(new Error('network down')));

    await expect(
      uploadSetupReview(buildSession({ installDir: dir }), CREDS, fetchImpl),
    ).resolves.toBeUndefined();
  });
});
