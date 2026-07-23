import {
  Harness,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
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

describe('orchestrator gating — the single flag', () => {
  const program = 'posthog-integration' as const;

  it('routes the orchestrator on pi from the one flag', () => {
    // pi implements runTask — the capability clamp passes and the flag stands.
    const binding = resolveBinding({
      program,
      flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
    });
    expect(binding.harness).toBe(Harness.pi);
    expect(binding.sequence).toBe(Sequence.orchestrator);
  });

  it('flag off → the binding default, both axes', () => {
    const binding = resolveBinding({
      program,
      flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'false' },
    });
    expect(binding.harness).toBe(Harness.anthropic);
    expect(binding.sequence).toBe(Sequence.linear);
  });
});
