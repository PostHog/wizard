/**
 * How long the standalone `wizard warehouse` command waits for a credential.
 *
 * The same source credentials are collected two ways: as the orchestrator's
 * seeded warehouse task, and as this command — the one the outro points at
 * when the user declines the offer or a source falls back to browser setup.
 * The command was on the 5-minute default, so the fallback route gave the
 * user a quarter of the time the in-run prompt does for identical questions.
 */
import type { RunnerContext } from '@programs/runner-context';
import type { WizardSession } from '@programs/session/wizard-session';

vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  } as never,
}));

import { config as warehouseSource } from '@programs/warehouse-source';
import {
  DEFAULT_ASK_TIMEOUT_MS,
  LONGER_ASK_TIMEOUT_MS,
} from '@shared/ask-policy';

/** The host effects a run may use; this run uses none. */
const runner: RunnerContext = {
  getFrameworkContext: () => undefined,
  setFrameworkContext: () => undefined,
  log: { info: () => undefined, warn: () => undefined },
  spinner: () => ({
    start: () => undefined,
    stop: () => undefined,
    message: () => undefined,
  }),
};

function session(): WizardSession {
  return { installDir: '/tmp/app', frameworkContext: {} } as WizardSession;
}

describe('warehouse command ask timeout', () => {
  it('gives credential questions the shared allowance, not the default', async () => {
    const { run } = warehouseSource;
    const resolved =
      typeof run === 'function' ? await run(session(), runner) : run;

    expect(resolved?.askTimeoutMs).toBe(LONGER_ASK_TIMEOUT_MS);
    expect(resolved?.askTimeoutMs).toBeGreaterThan(DEFAULT_ASK_TIMEOUT_MS);
  });
});
