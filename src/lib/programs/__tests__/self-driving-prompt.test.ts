import { buildSelfDrivingPrompt } from '@lib/programs/self-driving/prompt';
import type { PromptContext } from '@lib/agent/agent-runner';
import { HostResolution } from '@lib/host-resolution';

const ctx: PromptContext = {
  projectId: 123,
  projectApiKey: 'phc_test',
  host: HostResolution.fromApiHost('https://us.posthog.com'),
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

  it('enables products before sources, mirroring the skill step labels', () => {
    const prompt = buildSelfDrivingPrompt(ctx);
    // Step labels match the context-mill skill files exactly (3b before 4), so the
    // wizard STEP and the `(skill: …)` reference never disagree on the number.
    expect(prompt).toContain('STEP 3b — Enable products');
    expect(prompt).toContain('STEP 4 — Enable signal sources');
    expect(prompt.indexOf('STEP 3b — Enable products')).toBeLessThan(
      prompt.indexOf('STEP 4 — Enable signal sources'),
    );
    // Tail mirrors the skill: custom scouts is 6b, report is 7.
    expect(prompt).toContain('STEP 6b — Design custom scouts');
    expect(prompt).toContain('STEP 7 — Write the report and hand off');
  });
});
