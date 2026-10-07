import { buildCodingAgentPrompt } from '../handoff';

const NOTEBOOK_URL = 'https://us.posthog.com/project/1/notebooks/AbCdEfGh';

describe('buildCodingAgentPrompt', () => {
  it('references the given notebook URL', () => {
    const prompt = buildCodingAgentPrompt(NOTEBOOK_URL);
    expect(prompt).toContain(NOTEBOOK_URL);
  });

  it('points the agent at the report checklist, on a single line', () => {
    const prompt = buildCodingAgentPrompt(NOTEBOOK_URL);
    expect(prompt).toContain('Verify before merging');
    // Single line keeps triple-click selection clean in the terminal.
    expect(prompt).not.toContain('\n');
  });

  it('asks the agent to investigate and get consent before changing anything, without prescribing a workflow', () => {
    // Explicit consent for actions with real implications (e.g. source-map
    // upload) — but no PR mandate / edit-style rules; the operator governs how
    // changes land in their own agent.
    const prompt = buildCodingAgentPrompt(NOTEBOOK_URL).toLowerCase();
    expect(prompt).toContain('investigate'); // explore first
    expect(prompt).toContain('approval'); // explicit consent gate
    expect(prompt).not.toMatch(/open a pr|minimal/); // no prescribed workflow
  });

  it('does not reference a local report file (the report lives in the notebook)', () => {
    const prompt = buildCodingAgentPrompt(NOTEBOOK_URL);
    expect(prompt).not.toContain('posthog-setup-report.md');
  });

  it('threads the notebook URL through rather than hardcoding it', () => {
    const prompt = buildCodingAgentPrompt('https://example.com/notebooks/x');
    expect(prompt).toContain('https://example.com/notebooks/x');
    expect(prompt).not.toContain('us.posthog.com');
  });
});
