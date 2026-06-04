const mockRunWizard = jest.fn();
const mockRunWizardCI = jest.fn();

jest.mock('@lib/runners', () => ({
  runWizard: mockRunWizard,
  runWizardCI: mockRunWizardCI,
}));

import type { Arguments } from 'yargs';
import { integrateCommand } from '../commands/integrate';
import { auditCommand } from '../commands/audit';
import { migrateCommand } from '../commands/migrate';
import { parseCommand } from './helpers/parse-command.no-jest';

function makeArgv(extra: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extra } as Arguments;
}

describe('program commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('each command exposes its CLI name', () => {
    expect(integrateCommand.name).toBe('integrate');
    expect(auditCommand.name).toBe('audit');
    expect(migrateCommand.name).toBe('migrate');
  });

  test('nests web analytics doctor under audit', () => {
    expect(auditCommand.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'web-analytics' }),
      ]),
    );
  });

  test('dispatches to runWizard by default', () => {
    auditCommand.handler!(makeArgv({ debug: true }));
    expect(mockRunWizard).toHaveBeenCalledTimes(1);
    expect(mockRunWizardCI).not.toHaveBeenCalled();
    expect(mockRunWizard.mock.calls[0][1]).toMatchObject({ debug: true });
  });

  test('dispatches to runWizardCI when --ci is set', () => {
    auditCommand.handler!(makeArgv({ ci: true }));
    expect(mockRunWizardCI).toHaveBeenCalledTimes(1);
    expect(mockRunWizard).not.toHaveBeenCalled();
  });

  test('forwards --install-dir to the runner', () => {
    integrateCommand.handler!(makeArgv({ installDir: '/tmp/some-app' }));
    const opts = mockRunWizard.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.installDir).toBe('/tmp/some-app');
  });

  test('merges mapCliOptions output into runner args (migrate)', () => {
    migrateCommand.handler!(makeArgv({ product: 'statsig' }));
    const opts = mockRunWizard.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.product).toBe('statsig');
    // migration maps --product into a skillId
    expect(typeof opts.skillId).toBe('string');
  });

  test('exposes the shared skill options on each command', () => {
    expect(auditCommand.options).toMatchObject({
      debug: expect.any(Object),
      'install-dir': expect.any(Object),
      'local-mcp': expect.any(Object),
      benchmark: expect.any(Object),
    });
  });

  test('merges per-program cliOptions on top of the shared set (migrate)', () => {
    expect(migrateCommand.options).toMatchObject({
      debug: expect.any(Object),
      product: expect.any(Object),
    });
  });

  test('camelCases --install-dir end-to-end through yargs', async () => {
    const argv = await parseCommand(
      auditCommand,
      'audit --install-dir /tmp/app',
    );
    expect(argv.installDir).toBe('/tmp/app');
  });

  test('parses audit web-analytics through yargs', async () => {
    const argv = await parseCommand(
      auditCommand,
      'audit web-analytics --install-dir /tmp/app',
    );
    expect(argv.installDir).toBe('/tmp/app');
  });
});
