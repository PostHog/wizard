const mockRunWizard = jest.fn();
const mockRunWizardCI = jest.fn();

jest.mock('@lib/runners', () => ({
  runWizard: mockRunWizard,
  runWizardCI: mockRunWizardCI,
}));

import type { Arguments } from 'yargs';

import type { ProgramConfig } from '@lib/programs/program-step';

import { nativeCommandFactory } from '../native-command-factory';

function makeArgv(extra: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extra } as Arguments;
}

function buildTestConfig(
  overrides: Partial<ProgramConfig> = {},
): ProgramConfig {
  return {
    command: 'demo',
    description: 'demo program',
    id: 'demo',
    steps: [],
    ...overrides,
  };
}

describe('nativeCommandFactory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses command and description from the program config', () => {
    const cmd = nativeCommandFactory(buildTestConfig());
    expect(cmd.name).toBe('demo');
    expect(cmd.description).toBe('demo program');
  });

  it('throws when the program has no command name', () => {
    expect(() =>
      nativeCommandFactory(buildTestConfig({ command: undefined })),
    ).toThrow(/has no `command`/);
  });

  it('merges skill-program options with program-specific cliOptions', () => {
    const cmd = nativeCommandFactory(
      buildTestConfig({
        cliOptions: {
          flavor: {
            type: 'string' as const,
            choices: ['vanilla', 'chocolate'],
          },
        },
      }),
    );
    // Per-command skill-program option (--install-dir) is present.
    // Global flags (--debug, --local-mcp, --benchmark, --yara-report, --ci)
    // live in wizard.ts GLOBAL_OPTIONS, not on the per-command options.
    expect(cmd.options).toHaveProperty('install-dir');
    // Program-specific options are present
    expect(cmd.options).toHaveProperty('flavor');
  });

  it('passes children through unchanged', () => {
    const child = {
      name: 'inner',
      description: 'inner',
      handler: () => undefined,
    };
    const cmd = nativeCommandFactory(buildTestConfig(), { children: [child] });
    expect(cmd.children).toEqual([child]);
  });

  it('handler routes to runWizard by default and applies mapCliOptions', () => {
    const config = buildTestConfig({
      mapCliOptions: (argv) => ({
        extra: `derived-from-${argv.foo as string}`,
      }),
    });
    const cmd = nativeCommandFactory(config);
    cmd.handler!(makeArgv({ foo: 'bar' }));

    expect(mockRunWizardCI).not.toHaveBeenCalled();
    expect(mockRunWizard).toHaveBeenCalledTimes(1);
    const [calledConfig, calledOptions] = mockRunWizard.mock.calls[0];
    expect(calledConfig).toBe(config);
    expect(calledOptions).toMatchObject({
      foo: 'bar',
      extra: 'derived-from-bar',
    });
  });

  it('handler routes to runWizardCI when --ci is set', () => {
    const config = buildTestConfig();
    const cmd = nativeCommandFactory(config);
    cmd.handler!(makeArgv({ ci: true }));

    expect(mockRunWizard).not.toHaveBeenCalled();
    expect(mockRunWizardCI).toHaveBeenCalledTimes(1);
    expect(mockRunWizardCI.mock.calls[0][0]).toBe(config);
  });
});
