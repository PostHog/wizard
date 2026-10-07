import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramAbort } from '@programs/program-abort';
import type { ProgramReadyContext } from '@programs/program-step';
import { buildSession } from '@programs/session/wizard-session';
import { config as posthogIntegration } from '@programs/posthog-integration';
import { testCiRunnerContext } from '@programs/shared/__tests__/runner-context.no-jest';
import { ErrorCodes } from '@shared/errors';
import { OutroKind } from '@shared/outro';
import { Integration } from '@shared/constants';

vi.mock('@programs/detection/project-scope', () => ({
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

function readyContext(
  session: ReturnType<typeof buildSession>,
): ProgramReadyContext {
  return {
    session,
    setFrameworkContext: (key, value) => {
      session.frameworkContext[key] = value;
    },
    setFrameworkConfig: vi.fn(),
    setDetectedFramework: vi.fn(),
    setPosthogSdkDetected: vi.fn(),
    setSkillId: vi.fn(),
    setUnsupportedVersion: vi.fn(),
    addDiscoveredFeature: vi.fn(),
    setDetectionComplete: vi.fn(),
  };
}

describe.each([
  {
    name: 'posthog-integration',
    program: posthogIntegration,
    integration: Integration.javascriptNode,
    dependencies: {},
    message: 'Could not detect a framework',
  },
])(
  '$name framework detection',
  ({ program, integration, dependencies, message }) => {
    let installDir: string;

    beforeEach(() => {
      installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-framework-'));
    });

    afterEach(() => {
      fs.rmSync(installDir, { recursive: true, force: true });
    });

    it('stops in CI with recovery guidance when no framework is found', async () => {
      const session = buildSession({ installDir, ci: true });

      const stopped = program.ciPreRun?.(session, testCiRunnerContext());

      await expect(stopped).rejects.toBeInstanceOf(ProgramAbort);
      await expect(stopped).rejects.toMatchObject({
        code: ErrorCodes.DetectNoFramework,
        message: expect.stringContaining(message),
        outroData: expect.objectContaining({
          kind: OutroKind.Error,
          instruction: expect.stringContaining('an app root directory'),
        }),
      });
      expect(session.integration).toBeFalsy();
    });

    it('completes detection for a recognized project', async () => {
      fs.writeFileSync(
        path.join(installDir, 'package.json'),
        JSON.stringify({ dependencies }),
      );
      const session = buildSession({ installDir });
      const ctx = readyContext(session);

      await program.onReady?.(ctx);

      expect(ctx.setSkillId).toHaveBeenCalledWith(integration);
      expect(ctx.setDetectionComplete).toHaveBeenCalled();
    });
  },
);

describe('posthog-integration with no detected framework', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-framework-'));
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  it('finishes interactive detection so the manual framework picker shows', async () => {
    const session = buildSession({ installDir });
    const ctx = readyContext(session);

    await posthogIntegration.onReady?.(ctx);

    expect(ctx.setDetectionComplete).toHaveBeenCalled();
    expect(ctx.setFrameworkConfig).not.toHaveBeenCalled();
  });

  it('stops the run, before the agent, when no framework was ever chosen', async () => {
    const session = buildSession({ installDir });

    const stopped = (
      posthogIntegration.run as NonNullable<
        typeof posthogIntegration.run
      > extends infer R
        ? Extract<R, (...args: never[]) => unknown>
        : never
    )(session, {} as never);

    await expect(stopped).rejects.toBeInstanceOf(ProgramAbort);
    await expect(stopped).rejects.toMatchObject({
      code: ErrorCodes.DetectNoFramework,
    });
  });
});
