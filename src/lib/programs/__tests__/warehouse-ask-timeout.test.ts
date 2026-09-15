/**
 * How long the standalone `wizard warehouse` command waits for a credential.
 *
 * The same source credentials are collected two ways: as the orchestrator's
 * seeded warehouse task, and as this command — the one the outro points at
 * when the user declines the offer or a source falls back to browser setup.
 * The command was on the 5-minute default, so the fallback route gave the
 * user a quarter of the time the in-run prompt does for identical questions.
 */
import type { WizardSession } from '@lib/wizard-session';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));

import { warehouseSourceConfig } from '@lib/programs/warehouse-source/index';
import {
  CREDENTIAL_ASK_TIMEOUT_MS,
  DEFAULT_ASK_TIMEOUT_MS,
} from '@lib/wizard-ask-bridge';

function session(): WizardSession {
  return { installDir: '/tmp/app', frameworkContext: {} } as WizardSession;
}

describe('warehouse command ask timeout', () => {
  it('gives credential questions the shared allowance, not the default', async () => {
    const { run } = warehouseSourceConfig;
    const resolved = typeof run === 'function' ? await run(session()) : run;

    expect(resolved?.askTimeoutMs).toBe(CREDENTIAL_ASK_TIMEOUT_MS);
    expect(resolved?.askTimeoutMs).toBeGreaterThan(DEFAULT_ASK_TIMEOUT_MS);
  });
});
