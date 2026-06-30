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
});
