import {
  WORKFLOW_REGISTRY,
  getWorkflowConfig,
  getSubcommandWorkflows,
} from '../workflow-registry.js';

describe('WORKFLOW_REGISTRY', () => {
  it('every entry has unique flowKey, description, and non-empty steps', () => {
    const flowKeys = WORKFLOW_REGISTRY.map((c) => c.flowKey);
    expect(new Set(flowKeys).size).toBe(flowKeys.length);

    for (const config of WORKFLOW_REGISTRY) {
      expect(config.description).toBeTruthy();
      expect(config.steps.length).toBeGreaterThan(0);
    }
  });
});

describe('getWorkflowConfig', () => {
  it('finds known configs by flowKey and returns undefined for unknown', () => {
    expect(getWorkflowConfig('posthog-integration')?.flowKey).toBe(
      'posthog-integration',
    );
    expect(getWorkflowConfig('revenue-analytics')?.command).toBe('revenue');
    expect(getWorkflowConfig('nonexistent')).toBeUndefined();
  });
});

describe('getSubcommandWorkflows', () => {
  it('returns only workflows that have a CLI command', () => {
    const subcommands = getSubcommandWorkflows();
    const commands = subcommands.map((c) => c.command);

    expect(commands).toContain('integrate');
    expect(commands).toContain('revenue');
    for (const config of subcommands) {
      expect(config.command).toBeTruthy();
    }
  });
});
