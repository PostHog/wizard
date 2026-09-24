/**
 * The default integration prompt's skill-workflow gating.
 *
 * STEP 1 scopes the linear agent to the framework skill, plus AI Observability
 * and Logs unless the flag turns them off. These tests check which branch the
 * flag selects.
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
