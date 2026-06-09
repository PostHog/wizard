const mockRunWizard = jest.fn();
const mockRunWizardCI = jest.fn();

jest.mock('@lib/runners', () => ({
  runWizard: mockRunWizard,
  runWizardCI: mockRunWizardCI,
}));

import type { Arguments } from 'yargs';

import type { ProgramConfig } from '@lib/programs/program-step';
import type { CliManifestEntry } from '@lib/programs/cli-manifest.generated';

import { skillCommandFactory } from '../skill-command-factory';

function makeArgv(extra: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extra } as Arguments;
}

function buildTestEntry(
  overrides: Partial<CliManifestEntry> = {},
): CliManifestEntry {
  return {
    skillId: 'demo-skill',
    surface: 'public',
    command: 'demo',
    displayName: 'Demo Skill',
    description: 'demo description from manifest',
    ...overrides,
  };
}

function buildTestConfig(
  overrides: Partial<ProgramConfig> = {},
): ProgramConfig {
  return {
    id: 'demo',
    description: 'demo description from config',
    steps: [],
    ...overrides,
  };
}

describe('skillCommandFactory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses command name from the manifest entry, not the program config', () => {
    const cmd = skillCommandFactory(
      buildTestEntry({ command: 'from-entry' }),
      buildTestConfig({ command: 'from-config' }),
    );
    expect(cmd.name).toBe('from-entry');
  });

  it('uses description from the manifest entry, not the program config', () => {
    const cmd = skillCommandFactory(buildTestEntry(), buildTestConfig());
    expect(cmd.description).toBe('demo description from manifest');
  });

  it('throws when the manifest entry is not public', () => {
    expect(() =>
      skillCommandFactory(
        buildTestEntry({ surface: 'catalog' }),
        buildTestConfig(),
      ),
    ).toThrow(/surface "catalog"/);
    expect(() =>
      skillCommandFactory(
        buildTestEntry({ surface: 'internal' }),
        buildTestConfig(),
      ),
    ).toThrow(/surface "internal"/);
  });

  it('throws when the manifest entry has no command name', () => {
    expect(() =>
      skillCommandFactory(
        { ...buildTestEntry(), command: undefined },
        buildTestConfig(),
      ),
    ).toThrow(/missing `command`/);
  });

  it('merges skill-program options with the program-specific cliOptions', () => {
    const cmd = skillCommandFactory(
      buildTestEntry(),
      buildTestConfig({
        cliOptions: {
          flavor: { type: 'string' as const },
        },
      }),
    );
    expect(cmd.options).toHaveProperty('debug');
    expect(cmd.options).toHaveProperty('flavor');
  });

  it('handler dispatches to runWizard with the program config', () => {
    const config = buildTestConfig({
      mapCliOptions: (argv) => ({ derived: argv.foo }),
    });
    const cmd = skillCommandFactory(buildTestEntry(), config);
    cmd.handler!(makeArgv({ foo: 'bar' }));

    expect(mockRunWizard).toHaveBeenCalledTimes(1);
    const [calledConfig, calledOptions] = mockRunWizard.mock.calls[0];
    expect(calledConfig).toBe(config);
    expect(calledOptions).toMatchObject({ foo: 'bar', derived: 'bar' });
  });

  it('handler routes to runWizardCI when --ci is set', () => {
    const cmd = skillCommandFactory(buildTestEntry(), buildTestConfig());
    cmd.handler!(makeArgv({ ci: true }));
    expect(mockRunWizardCI).toHaveBeenCalledTimes(1);
    expect(mockRunWizard).not.toHaveBeenCalled();
  });

  it('passes children through unchanged', () => {
    const child = {
      name: 'inner',
      description: 'inner',
      handler: () => undefined,
    };
    const cmd = skillCommandFactory(buildTestEntry(), buildTestConfig(), {
      children: [child],
    });
    expect(cmd.children).toEqual([child]);
  });
});
