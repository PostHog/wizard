import { buildSelfDrivingPrompt } from '@lib/programs/self-driving/prompt';
import type { PromptContext } from '@lib/agent/agent-runner';

const ctx: PromptContext = {
  projectId: 123,
  projectApiKey: 'phc_test',
  host: 'https://us.posthog.com',
};

describe('buildSelfDrivingPrompt', () => {
  it('covers only the Self-driving steps — integration is a separate phase', () => {
    const prompt = buildSelfDrivingPrompt(ctx);
    // No SDK-integration step in the prompt; that runs as the prelude program.
    expect(prompt).not.toContain('STEP 0');
    expect(prompt).not.toContain('Integrate the PostHog SDK');
    expect(prompt).not.toContain('load_skill_menu');
    // The Self-driving steps are present.
    expect(prompt).toContain('STEP 1 — Check Self-driving access');
    expect(prompt).toContain('Connect GitHub');
  });

  it('enables products before sources, then runs the renumbered tail', () => {
    const prompt = buildSelfDrivingPrompt(ctx);
    // The new "Enable products" step lands before "Enable signal sources".
    expect(prompt).toContain('STEP 4 — Enable products');
    expect(prompt).toContain('STEP 5 — Enable signal sources');
    expect(prompt.indexOf('STEP 4 — Enable products')).toBeLessThan(
      prompt.indexOf('STEP 5 — Enable signal sources'),
    );
    // Tail steps renumbered through to the report.
    expect(prompt).toContain('STEP 9 — Write the report and hand off');
  });
});
