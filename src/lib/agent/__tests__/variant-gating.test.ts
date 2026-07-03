import {
  Harness,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  WIZARD_RUNNER_FLAG_KEY,
} from '@lib/constants';
import {
  isOrchestratorEnabled,
  resolveBinding,
} from '@lib/agent/runner/switchboard';

describe('isOrchestratorEnabled', () => {
  it('is true only when the wizard-orchestrator flag is true', () => {
    expect(isOrchestratorEnabled({ 'wizard-orchestrator': 'true' })).toBe(true);
  });

  it('is false when the flag is false, another flag, or absent', () => {
    expect(isOrchestratorEnabled({ 'wizard-orchestrator': 'false' })).toBe(
      false,
    );
    expect(isOrchestratorEnabled({ 'wizard-variant': 'orchestrator' })).toBe(
      false,
    );
    expect(isOrchestratorEnabled({})).toBe(false);
    expect(isOrchestratorEnabled()).toBe(false);
  });
});

describe('pi + orchestrator gating', () => {
  const program = 'posthog-integration' as const;

  it('clamps the sequence to linear when both flags select pi + orchestrator', () => {
    // pi has no runTask — this flag combination must never resolve to a
    // crashing cohort; the clamp middleware forces linear.
    const binding = resolveBinding({
      program,
      flags: {
        [WIZARD_RUNNER_FLAG_KEY]: Harness.pi,
        [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true',
      },
    });
    expect(binding.harness).toBe(Harness.pi);
    expect(binding.sequence).toBe(Sequence.linear);
  });

  it('leaves the orchestrator flag effective for the anthropic harness', () => {
    const binding = resolveBinding({
      program,
      flags: {
        [WIZARD_RUNNER_FLAG_KEY]: Harness.anthropic,
        [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true',
      },
    });
    expect(binding.harness).toBe(Harness.anthropic);
    expect(binding.sequence).toBe(Sequence.orchestrator);
  });

  it('resolves pi alone to linear (the binding default)', () => {
    const binding = resolveBinding({
      program,
      flags: { [WIZARD_RUNNER_FLAG_KEY]: Harness.pi },
    });
    expect(binding.harness).toBe(Harness.pi);
    expect(binding.sequence).toBe(Sequence.linear);
  });
});
