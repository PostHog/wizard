import {
  PROGRAM_REGISTRY,
  getProgramConfig,
  getSubcommandPrograms,
} from '../program-registry.js';

describe('PROGRAM_REGISTRY', () => {
  it('every entry has unique id, description, and non-empty steps', () => {
    const ids = PROGRAM_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const config of PROGRAM_REGISTRY) {
      expect(config.description).toBeTruthy();
      expect(config.steps.length).toBeGreaterThan(0);
    }
  });
});

describe('getProgramConfig', () => {
  it('finds known configs by id and returns undefined for unknown', () => {
    expect(getProgramConfig('posthog-integration')?.id).toBe(
      'posthog-integration',
    );
    expect(getProgramConfig('revenue-analytics-setup')?.command).toBe(
      'revenue',
    );
    expect(getProgramConfig('nonexistent')).toBeUndefined();
  });
});

describe('getSubcommandPrograms', () => {
  it('returns only programs that have a CLI command', () => {
    const subcommands = getSubcommandPrograms();
    const commands = subcommands.map((c) => c.command);

    expect(commands).toContain('integrate');
    expect(commands).toContain('revenue');
    for (const config of subcommands) {
      expect(config.command).toBeTruthy();
    }
  });
});
