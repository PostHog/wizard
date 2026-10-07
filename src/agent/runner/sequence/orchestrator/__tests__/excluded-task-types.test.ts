/**
 * Pins the flag→exclusion hookup through the same helper the runner feeds to
 * the registry and the seed note. Each program's own tests pin its mapping.
 */

import { effectiveExcludedTaskTypes } from '../orchestrator-runner';

const source = {
  excludedTaskTypes: (flags: Record<string, string>) =>
    flags['skip-logs'] === 'true' ? ['logs'] : [],
};

describe('effectiveExcludedTaskTypes', () => {
  it("excludes what the run config's mapping returns for the run's flags", () => {
    expect(effectiveExcludedTaskTypes(source, { 'skip-logs': 'true' })).toEqual(
      expect.arrayContaining(['logs']),
    );
  });

  it('excludes nothing extra when the mapping returns nothing, or there is none', () => {
    expect(effectiveExcludedTaskTypes(source, {})).not.toContain('logs');
    expect(
      effectiveExcludedTaskTypes({}, { 'skip-logs': 'true' }),
    ).not.toContain('logs');
  });
});
