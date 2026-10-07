/** A security stop in an orchestrator task says so, as the linear sequence does. */
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

import { AgentErrorType } from '@agent/agent-interface';
import { terminalResult } from '@agent/runner/sequence/orchestrator/orchestrator-runner';
import { formatYaraAbortMessage } from '@agent/yara-hooks';
import { ErrorCodes } from '@shared/errors';

it('a YARA failure carries the security-stop message and code', () => {
  expect(
    terminalResult({
      kind: 'failure',
      classification: AgentErrorType.YARA_VIOLATION,
    }),
  ).toMatchObject({
    failure: {
      code: ErrorCodes.AgentYaraViolation,
      message: formatYaraAbortMessage(),
    },
  });
});
