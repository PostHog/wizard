import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAgent } from '@lib/agent/agent-runner';
import { auditRunStep } from '@lib/programs/audit/index';
import { uploadSetupReview } from '@lib/programs/audit/setup-review';
import { selfDrivingConfig } from '@lib/programs/self-driving/index';
import {
  SELF_DRIVING_INTEGRATE_PATH_KEY,
  POSTHOG_PRESENT_KEY,
} from '@lib/programs/self-driving/detect';
import { buildSession, type Credentials } from '@lib/wizard-session';
import { HostResolution } from '@lib/host-resolution';

vi.mock('@lib/agent/agent-runner', () => ({ runAgent: vi.fn() }));
vi.mock('@lib/programs/audit/setup-review', () => ({
  uploadSetupReview: vi.fn(),
}));

const CREDS: Credentials = {
  host: HostResolution.fromApiHost('https://us.posthog.com'),
  projectId: 42,
  accessToken: 'pha_abc',
  projectApiKey: 'phc_test',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('self-driving audit wiring', () => {
  const steps = selfDrivingConfig.steps;
  const auditStep = steps.find((s) => s.id === 'audit-run');

  it('places audit-run between integrate-run and the handoff', () => {
    const ids = steps.map((s) => s.id);
    expect(ids.indexOf('audit-run')).toBe(ids.indexOf('integrate-run') + 1);
    expect(ids.indexOf('audit-run')).toBe(
      ids.indexOf('self-driving-handoff') - 1,
    );
  });

  it.each([
    ['posthog already present', { [POSTHOG_PRESENT_KEY]: true }, null, true],
    ['fresh integration', {}, true, true],
    ['integration declined', {}, false, false],
  ])(
    'shows the audit step for %s',
    (_name, frameworkContext, integrate, expected) => {
      const session = buildSession({ installDir: '/repo' });
      session.frameworkContext = frameworkContext;
      session.integrate = integrate;
      expect(auditStep?.show?.(session)).toBe(expected);
    },
  );

  it('audits the picked sub-app dir, falling back to the repo root', () => {
    const session = buildSession({ installDir: '/repo' });
    expect(auditStep?.targetDir?.(session)).toBe('/repo');
    session.frameworkContext[SELF_DRIVING_INTEGRATE_PATH_KEY] = 'apps/web';
    expect(auditStep?.targetDir?.(session)).toBe(
      path.join('/repo', 'apps', 'web'),
    );
  });

  it('runs the audit composed, best-effort, and without its own upload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-audit-'));
    try {
      const session = buildSession({ installDir: dir });
      await auditRunStep.run?.(session);

      expect(runAgent).toHaveBeenCalledTimes(1);
      const [config, , opts] = vi.mocked(runAgent).mock.calls[0];
      expect(opts).toEqual({ composed: true });
      const programRun =
        typeof config.run === 'function' ? await config.run(session) : null;
      expect(programRun?.bestEffort).toBe(true);
      expect(programRun?.postRun).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uploads the ledger from the integration dir in postRun', async () => {
    const session = buildSession({ installDir: '/repo' });
    session.frameworkContext[SELF_DRIVING_INTEGRATE_PATH_KEY] = 'apps/web';

    const run =
      typeof selfDrivingConfig.run === 'function'
        ? await selfDrivingConfig.run(session)
        : selfDrivingConfig.run;
    await run?.postRun?.(session, CREDS);

    expect(uploadSetupReview).toHaveBeenCalledTimes(1);
    const [uploadSession, creds] = vi.mocked(uploadSetupReview).mock.calls[0];
    expect(uploadSession.installDir).toBe(path.join('/repo', 'apps', 'web'));
    expect(creds).toBe(CREDS);
  });
});
