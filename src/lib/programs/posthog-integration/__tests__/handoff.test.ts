import { buildCodingAgentPrompt } from '../handoff';

const NOTEBOOK_URL = 'https://us.posthog.com/project/1/notebooks/AbCdEfGh';

describe('buildCodingAgentPrompt', () => {
  it('references the given notebook URL', () => {
    const prompt = buildCodingAgentPrompt(NOTEBOOK_URL);
    expect(prompt).toContain(NOTEBOOK_URL);
  });

  it('keeps the prompt on a single line', () => {
    const prompt = buildCodingAgentPrompt(NOTEBOOK_URL);
    // Single line keeps triple-click selection clean in the terminal.
    expect(prompt).not.toContain('\n');
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
