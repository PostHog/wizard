const mockRunWizard = jest.fn();
const mockRunWizardCI = jest.fn();

jest.mock('@lib/runners', () => ({
  runWizard: mockRunWizard,
  runWizardCI: mockRunWizardCI,
}));

import type { Arguments } from 'yargs';
import type { Command } from '../commands/command';
import { auditCommand } from '../commands/audit';
import { migrateCommand } from '../commands/migrate';
import { revenueCommand } from '../commands/revenue';
import { parseCommand } from './helpers/parse-command.no-jest';

function makeArgv(extra: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extra } as Arguments;
}

function findChild(parent: Command, name: string): Command | undefined {
  return parent.children?.find((c) => {
    const first = Array.isArray(c.name) ? c.name[0] : c.name;
    return first.split(/\s+/)[0] === name;
  });
}

describe('program commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('each top-level command exposes its CLI name', () => {
    expect(auditCommand.name).toBe('audit');
    expect(migrateCommand.name).toBe('migrate');
    expect(revenueCommand.name).toBe('revenue');
  });

  test('audit nests web-analytics-doctor as a wizard-native child', () => {
    expect(auditCommand.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'web-analytics' }),
      ]),
    );
  });

  test('audit exposes a subcommand for each public manifest entry', () => {
    const names = (auditCommand.children ?? []).map((c) =>
      Array.isArray(c.name) ? c.name[0] : c.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'all',
        'autocapture',
        'events',
        'flags',
        'identify',
        'session-replay',
      ]),
    );
  });

  test('migrate exposes one child per migrate-* manifest entry', () => {
    const names = (migrateCommand.children ?? []).map((c) =>
      Array.isArray(c.name) ? c.name[0] : c.name,
    );
    expect(names).toEqual(expect.arrayContaining(['statsig']));
  });

  test('audit family has no top-level handler (subcommand required)', () => {
    expect(auditCommand.handler).toBeUndefined();
  });

  test('audit events dispatches to runWizard by default', () => {
    const child = findChild(auditCommand, 'events');
    expect(child).toBeDefined();
    child!.handler!(makeArgv({ debug: true }));
    expect(mockRunWizard).toHaveBeenCalledTimes(1);
    expect(mockRunWizardCI).not.toHaveBeenCalled();
    expect(mockRunWizard.mock.calls[0][1]).toMatchObject({ debug: true });
  });

  test('audit events dispatches to runWizardCI when --ci is set', () => {
    const child = findChild(auditCommand, 'events');
    child!.handler!(makeArgv({ ci: true }));
    expect(mockRunWizardCI).toHaveBeenCalledTimes(1);
    expect(mockRunWizard).not.toHaveBeenCalled();
  });

  test('skillCommandFactory injects the manifest entry skillId into the dispatched config', () => {
    const events = findChild(auditCommand, 'events');
    events!.handler!(makeArgv());
    const dispatchedConfig = mockRunWizard.mock.calls[0][0] as {
      skillId?: string;
    };
    expect(dispatchedConfig.skillId).toBe('audit-events');
  });

  test('migrate statsig dispatches with migrate-statsig skillId', () => {
    const statsig = findChild(migrateCommand, 'statsig');
    expect(statsig).toBeDefined();
    statsig!.handler!(makeArgv({ installDir: '/tmp/some-app' }));
    const [config, opts] = mockRunWizard.mock.calls[0] as [
      { skillId?: string },
      Record<string, unknown>,
    ];
    expect(config.skillId).toBe('migrate-statsig');
    expect(opts.installDir).toBe('/tmp/some-app');
  });

  test('revenue is a flat skill command', () => {
    expect(revenueCommand.name).toBe('revenue');
    expect(revenueCommand.children).toBeUndefined();
    revenueCommand.handler!(makeArgv({ debug: true }));
    const [config] = mockRunWizard.mock.calls[0] as [{ skillId?: string }];
    expect(config.skillId).toBe('revenue-analytics-setup');
  });

  test('exposes the shared skill options on each command', () => {
    const child = findChild(auditCommand, 'events');
    expect(child!.options).toMatchObject({
      debug: expect.any(Object),
      'install-dir': expect.any(Object),
      'local-mcp': expect.any(Object),
      benchmark: expect.any(Object),
    });
  });

  test('camelCases --install-dir end-to-end through yargs', async () => {
    const argv = await parseCommand(
      auditCommand,
      'audit events --install-dir /tmp/app',
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
