/**
 * The default integration prompt's skill-workflow instructions.
 *
 * STEP 1 scopes the linear agent to exactly three skill categories: the
 * framework skill first, then AI Observability and Logs when its workflow
 * calls for them. These tests pin that scoping — the allowlist, the delegation
 * to the skill's workflow, and the hard guard against every other category.
 */

import { WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY } from '@shared/constants';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import { analytics } from '@utils/analytics';
import { promptFor } from './helpers/integration-prompt.no-jest';

// The run builder reads the run's wizard flags; keep tests hermetic and let
// each case choose the flag state. Empty map = flags unreadable = include.
beforeEach(() => {
  vi.spyOn(analytics, 'getAllFlagsForWizard').mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('default integration skill workflow', () => {
  it('loads the framework category first and delegates observability to its workflow', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toContain('category: "integration"');
    expect(prompt).toContain('AI Observability and Logs skills');
    expect(prompt).toContain('before verification and the setup report');
  });

  it('forbids every category outside the three the run uses', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toContain(
      'Do NOT load or install skills from any other category',
    );
    expect(prompt).toContain('do not substitute `llm-analytics`');
  });
});

describe('linear-run flag gate', () => {
  it('drops AIO and Logs from the prompt when the flag is false', async () => {
    vi.spyOn(analytics, 'getAllFlagsForWizard').mockResolvedValue({
      [WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY]: 'false',
    });
    const prompt = await promptFor([]);
    expect(prompt).toContain('The `integration` category is the ONLY one');
    expect(prompt).toContain('skip that entire section');
    expect(prompt).not.toContain('load the AI Observability and Logs skills');
  });

  it('keeps the three-category workflow when the flag is unreadable', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toContain('load the AI Observability and Logs skills');
  });
});

describe('default observability flag gating', () => {
  const excluded = (flags: Record<string, string>) =>
    posthogIntegrationConfig.excludedTaskTypes!(flags);

  it("excludes AIO and Logs only on an explicit 'false'", () => {
    expect(excluded({ [WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY]: 'false' })).toEqual([
      'ai-observability',
      'logs',
    ]);
  });

  it('includes them when the flag is true, absent, or the fetch failed', () => {
    expect(excluded({ [WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY]: 'true' })).toEqual(
      [],
    );
    expect(excluded({})).toEqual([]);
  });
});
