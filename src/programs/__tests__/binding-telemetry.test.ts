import { expect, it, vi } from 'vitest';
import { Harness, Sequence } from '@shared/constants';
import { captureSwitchboardDecision } from '@programs';
import { analytics } from '@utils/analytics';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));
vi.mock('@utils/debug', async (original) => ({
  ...(await original<typeof import('@utils/debug')>()),
  logToFile: vi.fn(),
}));

it('records the caller-selected sequence source with the final route', () => {
  captureSwitchboardDecision(
    {
      program: 'posthog-integration',
      flags: {},
      cliSequence: Sequence.orchestrator,
      trace: { harness: 'binding', model: 'binding', sequence: 'cli' },
    },
    { sequence: Sequence.orchestrator, harness: Harness.pi, model: 'm' },
  );

  expect(analytics.wizardCapture).toHaveBeenCalledWith(
    'switchboard resolved',
    expect.objectContaining({
      program: 'posthog-integration',
      sequence_source: 'cli',
      sequence: Sequence.orchestrator,
      harness: Harness.pi,
      model: 'chosen-per-task',
      model_source: 'agent-prompts',
    }),
  );
});
