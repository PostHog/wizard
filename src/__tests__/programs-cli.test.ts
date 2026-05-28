const mockRunWizardPrograms = jest.fn();
const mockRunWizardCIPrograms = jest.fn();
const mockMapCliOptionsPrograms = jest.fn((argv: Record<string, unknown>) => ({
  mapped: true,
  source: argv.source,
}));

jest.mock('@lib/runners', () => ({
  runWizard: mockRunWizardPrograms,
  runWizardCI: mockRunWizardCIPrograms,
}));
jest.mock('@lib/programs/program-registry', () => ({
  Program: {},
  PROGRAM_REGISTRY: [],
  getProgramConfig: () => ({}),
  getSubcommandPrograms: () => [
    {
      id: 'integrate',
      command: 'integrate',
      description: 'Set up PostHog SDK integration',
      steps: [],
      run: null,
    },
    {
      id: 'mapper',
      command: 'mapper',
      description: 'Program with mapCliOptions',
      steps: [],
      run: null,
      cliOptions: {
        source: { type: 'string', describe: 'Source override' },
      },
      mapCliOptions: mockMapCliOptionsPrograms,
    },
  ],
}));

import type { Arguments } from 'yargs';
import { programCommands } from '../commands/programs';

function makeArgv(extra: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extra } as Arguments;
}

describe('programCommands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('builds one command per registry program with a subcommand', () => {
    expect(programCommands.map((c) => c.name)).toEqual(['integrate', 'mapper']);
  });

  test('dispatches to runWizard by default', () => {
    const integrate = programCommands.find((c) => c.name === 'integrate')!;
    integrate.handler!(makeArgv({ debug: true }));
    expect(mockRunWizardPrograms).toHaveBeenCalledTimes(1);
    expect(mockRunWizardCIPrograms).not.toHaveBeenCalled();
    expect(mockRunWizardPrograms.mock.calls[0][0]).toMatchObject({
      id: 'integrate',
    });
    expect(mockRunWizardPrograms.mock.calls[0][1]).toMatchObject({
      debug: true,
    });
  });

  test('dispatches to runWizardCI when --ci is set', () => {
    const integrate = programCommands.find((c) => c.name === 'integrate')!;
    integrate.handler!(makeArgv({ ci: true }));
    expect(mockRunWizardCIPrograms).toHaveBeenCalledTimes(1);
    expect(mockRunWizardPrograms).not.toHaveBeenCalled();
  });

  test('forwards --install-dir to the runner', () => {
    const integrate = programCommands.find((c) => c.name === 'integrate')!;
    integrate.handler!(makeArgv({ installDir: '/tmp/some-app' }));
    const opts = mockRunWizardPrograms.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(opts.installDir).toBe('/tmp/some-app');
  });

  test('merges mapCliOptions output into runner args', () => {
    const mapper = programCommands.find((c) => c.name === 'mapper')!;
    mapper.handler!(makeArgv({ source: 'stripe' }));
    expect(mockMapCliOptionsPrograms).toHaveBeenCalled();
    const opts = mockRunWizardPrograms.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(opts.source).toBe('stripe');
    expect(opts.mapped).toBe(true);
  });

  test('exposes the shared skill options on each command', () => {
    const integrate = programCommands.find((c) => c.name === 'integrate')!;
    expect(integrate.options).toMatchObject({
      debug: expect.any(Object),
      'install-dir': expect.any(Object),
      'local-mcp': expect.any(Object),
      benchmark: expect.any(Object),
    });
  });

  test('merges per-program cliOptions on top of the shared set', () => {
    const mapper = programCommands.find((c) => c.name === 'mapper')!;
    expect(mapper.options).toMatchObject({
      debug: expect.any(Object),
      source: expect.any(Object),
    });
  });
});
