/**
 * Pins the flag→exclusion hookup against the REAL posthog-integration config,
 * through the same helper the runner feeds to the registry and the seed note.
 * A refactor that disconnects the program's mapping from the run turns these
 * red — the mapping test alone cannot see that.
 */

import { WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY } from '@shared/constants';
import { posthogIntegrationConfig } from '@programs/posthog-integration/index';
import { effectiveExcludedTaskTypes } from '../orchestrator-runner';

describe('effectiveExcludedTaskTypes', () => {
  it("excludes both observability types when the real config sees flag 'false'", () => {
    const excluded = effectiveExcludedTaskTypes(posthogIntegrationConfig, {
      [WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY]: 'false',
    });
    expect(excluded).toEqual(
      expect.arrayContaining(['ai-observability', 'logs']),
    );
  });

  it('excludes neither for the shipped default — flag true or unreadable', () => {
    const cases: Record<string, string>[] = [
      {},
      { [WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY]: 'true' },
    ];
    for (const flags of cases) {
      const excluded = effectiveExcludedTaskTypes(
        posthogIntegrationConfig,
        flags,
      );
      expect(excluded).not.toContain('ai-observability');
      expect(excluded).not.toContain('logs');
    }
  });
});
