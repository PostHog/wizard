import { buildCodingAgentPrompt } from '../handoff';

describe('buildCodingAgentPrompt', () => {
  it('references the given report file', () => {
    const prompt = buildCodingAgentPrompt('posthog-setup-report.md');
    expect(prompt).toContain('`posthog-setup-report.md`');
  });

  it('points the agent at the report checklist, on a single line', () => {
    const prompt = buildCodingAgentPrompt('posthog-setup-report.md');
    expect(prompt).toContain('Verify before merging');
    // Single line keeps triple-click selection clean in the terminal.
    expect(prompt).not.toContain('\n');
  });

  it('asks the agent to investigate and get consent before changing anything, without prescribing a workflow', () => {
    // Explicit consent for actions with real implications (e.g. source-map
    // upload) — but no PR mandate / edit-style rules; the operator governs how
    // changes land in their own agent.
    const prompt = buildCodingAgentPrompt(
      'posthog-setup-report.md',
    ).toLowerCase();
    expect(prompt).toContain('investigate'); // explore first
    expect(prompt).toContain('approval'); // explicit consent gate
    expect(prompt).not.toMatch(/open a pr|minimal/); // no prescribed workflow
  });

  it('does not reference a separate next-steps file (content lives in the report)', () => {
    const prompt = buildCodingAgentPrompt('posthog-setup-report.md');
    expect(prompt).not.toContain('posthog-next-steps.md');
  });

  it('threads the report file name through rather than hardcoding it', () => {
    const prompt = buildCodingAgentPrompt('custom-report.md');
    expect(prompt).toContain('`custom-report.md`');
    expect(prompt).not.toContain('posthog-setup-report.md');
  });
});
