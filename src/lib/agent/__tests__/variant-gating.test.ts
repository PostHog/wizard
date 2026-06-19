import {
  buildWizardMetadata,
  isOrchestratorEnabled,
} from '@lib/agent/agent-interface';

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

describe('buildWizardMetadata', () => {
  it('selects a known variant header from the flag', () => {
    expect(buildWizardMetadata({ 'wizard-variant': 'subagents' })).toEqual({
      VARIANT: 'subagents',
    });
  });

  it('falls back to the base variant for unknown or missing flags', () => {
    expect(buildWizardMetadata({ 'wizard-variant': 'nope' })).toEqual({
      VARIANT: 'base',
    });
    expect(buildWizardMetadata({})).toEqual({ VARIANT: 'base' });
  });
});
