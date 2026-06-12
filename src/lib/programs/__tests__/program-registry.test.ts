import {
  PROGRAM_REGISTRY,
  getProgramConfig,
  getSubcommandPrograms,
} from '@lib/programs/program-registry';

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
  it('finds known configs by id', () => {
    expect(getProgramConfig('posthog-integration').id).toBe(
      'posthog-integration',
    );
    expect(getProgramConfig('revenue-analytics-setup').command).toBe('revenue');
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

describe('parentCommand nesting', () => {
  it('nests web-analytics-doctor under the audit command', () => {
    const webAnalytics = getProgramConfig('web-analytics-doctor');
    expect(webAnalytics.command).toBe('web-analytics');
    expect(webAnalytics.parentCommand).toBe('audit');
  });

  it('keeps audit as a top-level command', () => {
    const audit = getProgramConfig('audit');
    expect(audit.command).toBe('audit');
    expect(audit.parentCommand).toBeUndefined();
  });

  it('every parentCommand refers to a registered top-level command', () => {
    const topLevelCommands = new Set(
      getSubcommandPrograms()
        .filter((c) => c.parentCommand == null)
        .map((c) => c.command),
    );
    const parentCommands = getSubcommandPrograms()
      .map((c) => c.parentCommand)
      .filter((p): p is string => p != null);
    for (const parent of parentCommands) {
      expect(topLevelCommands).toContain(parent);
    }
  });
});
