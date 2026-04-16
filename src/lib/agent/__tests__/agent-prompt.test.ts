import { assemblePrompt, type PromptContext } from '../agent-prompt.js';
import type { WorkflowRun } from '../agent-runner.js';

function makeRunDef(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    integrationLabel: 'test',
    spinnerMessage: 'Working...',
    successMessage: 'Done!',
    estimatedDurationMinutes: 5,
    reportFile: 'test-report.md',
    docsUrl: 'https://example.com/docs',
    ...overrides,
  };
}

const baseCtx: PromptContext = {
  projectId: 42,
  projectApiKey: 'phc_test123',
  host: 'https://app.posthog.com',
};

describe('assemblePrompt', () => {
  it('always includes project credentials in the default section', () => {
    const prompt = assemblePrompt(makeRunDef(), baseCtx);

    expect(prompt).toContain('42');
    expect(prompt).toContain('phc_test123');
    expect(prompt).toContain('https://app.posthog.com');
  });

  it('composes three sections in order: default → custom → skill', () => {
    const customFn = jest.fn(() => 'CUSTOM_INSTRUCTIONS');
    const runDef = makeRunDef({ customPrompt: customFn });
    const ctx: PromptContext = { ...baseCtx, skillPath: '/skills/test' };

    const prompt = assemblePrompt(runDef, ctx);

    // All three sections present
    expect(prompt).toContain('PostHog MCP server');
    expect(prompt).toContain('CUSTOM_INSTRUCTIONS');
    expect(prompt).toContain('SKILL.md');

    // Ordering is enforced
    const order = [
      prompt.indexOf('PostHog MCP server'),
      prompt.indexOf('CUSTOM_INSTRUCTIONS'),
      prompt.indexOf('SKILL.md'),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // customPrompt receives the context
    expect(customFn).toHaveBeenCalledWith(ctx);
  });

  it('omits custom and skill sections when not configured', () => {
    const prompt = assemblePrompt(makeRunDef(), baseCtx);

    expect(prompt).not.toContain('SKILL.md');
    // Only the default section — should be shorter than a full 3-section prompt
    const full = assemblePrompt(makeRunDef({ customPrompt: () => 'X' }), {
      ...baseCtx,
      skillPath: '/s',
    });
    expect(prompt.length).toBeLessThan(full.length);
  });
});
