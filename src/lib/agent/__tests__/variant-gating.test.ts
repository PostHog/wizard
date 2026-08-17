import { isOrchestratorEnabled } from '@lib/agent/runner/switchboard';

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
