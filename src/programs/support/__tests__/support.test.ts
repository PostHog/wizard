import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ProgramAbort } from '@programs/program-contract';
import type { ProgramRun } from '@programs/program-contract';
import { buildSession } from '@services/session';
import { config as support, SUPPORT_SUPPORTED } from '@programs/support';
import { testCiRunnerContext } from '@programs/shared/__tests__/runner-context.no-jest';
import type { Credentials } from '@shared/api';
import { Integration } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';

vi.mock('@services/detection/project-scope', () => ({
  scopeInstallDirToProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@utils/analytics', () => ({
  analytics: {
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));

describe('support outro next steps', () => {
  test('link the Support settings in the run project', () => {
    const run = support.run as ProgramRun;
    const credentials = {
      host: { appHost: 'https://us.posthog.com/' },
      projectId: 42,
    } as unknown as Credentials;

    const items = run.buildOutroNextSteps!(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      credentials,
      [],
    )!.items;

    expect(items).toContain(
      'Turn on the in-app widget and set its allowed domains: https://us.posthog.com/project/42/support/settings',
    );
  });
});

describe('support platform gate', () => {
  test('supports web apps and server-rendered templates', () => {
    for (const integration of [
      Integration.nextjs,
      Integration.javascript_web,
      Integration.django,
      Integration.rails,
    ]) {
      expect(SUPPORT_SUPPORTED.has(integration)).toBe(true);
    }
  });

  test('rejects mobile and backend-only platforms', () => {
    for (const integration of [
      Integration.reactNative,
      Integration.swift,
      Integration.android,
      Integration.flutter,
      Integration.javascriptNode,
      Integration.go,
    ]) {
      expect(SUPPORT_SUPPORTED.has(integration)).toBe(false);
    }
  });
});

describe('support headless detection', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-'));
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  test('aborts on a backend-only Node project', async () => {
    fs.writeFileSync(
      path.join(installDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    );
    const session = buildSession({ installDir, ci: true });

    const stopped = support.ciPreRun?.(session, testCiRunnerContext());

    await expect(stopped).rejects.toBeInstanceOf(ProgramAbort);
    await expect(stopped).rejects.toMatchObject({
      code: ErrorCodes.DetectUnsupportedPlatform,
    });
  });

  test('aborts with Support guidance when no framework is found', async () => {
    const session = buildSession({ installDir, ci: true });

    const stopped = support.ciPreRun?.(session, testCiRunnerContext());

    await expect(stopped).rejects.toMatchObject({
      code: ErrorCodes.DetectNoFramework,
      message: expect.stringContaining('Support widget'),
    });
  });
});
