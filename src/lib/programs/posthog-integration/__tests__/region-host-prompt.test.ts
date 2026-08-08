import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import { DJANGO_AGENT_CONFIG } from '@frameworks/django/django-wizard-agent';
import type { WizardSession } from '@lib/wizard-session';
import type { PromptContext } from '@lib/agent/agent-prompt';
import * as os from 'node:os';

function makeSession(): WizardSession {
  return {
    installDir: os.tmpdir(),
    frameworkConfig: DJANGO_AGENT_CONFIG,
    frameworkContext: {},
    additionalFeatureQueue: [],
  } as unknown as WizardSession;
}

/**
 * Regression: the auto-generated config must default POSTHOG_HOST to the
 * detected region's host, not the US fallback. An EU user selecting EU in the
 * CLI was getting `POSTHOG_HOST = os.environ.get('POSTHOG_HOST',
 * 'https://us.i.posthog.com')` because the agent copied the US literal from
 * example code. The prompt now tells the agent to use the detected host as the
 * fallback default.
 */
describe('integration prompt threads the region host into generated fallbacks', () => {
  const euCtx: PromptContext = {
    projectId: 42,
    projectApiKey: 'phc_test',
    host: 'https://eu.i.posthog.com',
  };

  it('instructs the agent to use the EU host as the fallback default', async () => {
    const run = await posthogIntegrationConfig.run(makeSession());
    const prompt = run.customPrompt!(euCtx);

    // The detected host is present and called out as the fallback default.
    expect(prompt).toContain('https://eu.i.posthog.com');
    // It explicitly warns against emitting a mismatched-region fallback.
    expect(prompt).toContain('region-correct host');
    expect(prompt).toContain(
      'Never emit a fallback host for a different region than the detected one.',
    );
    // The US literal only ever appears as the example of what NOT to hardcode,
    // never as the value the agent should use.
    expect(prompt).not.toMatch(
      /use https:\/\/us\.i\.posthog\.com as that default/,
    );
  });
});
