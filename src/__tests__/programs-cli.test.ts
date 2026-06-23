const mockRunWizard = jest.fn();
const mockRunWizardCI = jest.fn();

jest.mock('@lib/runners', () => ({
  runWizard: mockRunWizard,
  runWizardCI: mockRunWizardCI,
}));

jest.mock('@lib/wizard-tools', () => {
  const actual = jest.requireActual('@lib/wizard-tools');
  return {
    ...actual,
    fetchSkillMenu: jest.fn(),
  };
});

import type { Arguments } from 'yargs';
import { auditCommand } from '../commands/audit';
import { migrateCommand } from '../commands/migrate';
import { revenueCommand } from '../commands/revenue';
import { warehouseCommand } from '../commands/warehouse';
import { uploadSourcemapsCommand } from '../commands/upload-sourcemaps';
import { selfDrivingCommand } from '../commands/self-driving';
import {
  dispatchFamily,
  pickerChildrenToShow,
} from '@lib/programs/dispatch-family';
import type { Command } from '../commands/command';
import { fetchSkillMenu, type CliEntry } from '@lib/wizard-tools';
import { auditConfig } from '@lib/programs/audit/index';
import { webAnalyticsDoctorConfig } from '@lib/programs/web-analytics-doctor/index';
import { parseCommand } from './helpers/parse-command.no-jest';

const mockFetchSkillMenu = fetchSkillMenu as jest.MockedFunction<
  typeof fetchSkillMenu
>;

function makeArgv(extra: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extra } as Arguments;
}

function entry(partial: Partial<CliEntry> & { skillId: string }): CliEntry {
  return {
    role: 'command',
    displayName: partial.skillId,
    description: `desc for ${partial.skillId}`,
    ...partial,
  };
}

function mockMenu(cliEntries: CliEntry[]): void {
  mockFetchSkillMenu.mockResolvedValue({ categories: {}, cliEntries });
}

describe('top-level command shapes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('audit registers as a family with a [skill] positional', () => {
    expect(auditCommand.name).toBe('audit [skill]');
    // The family parent dispatches via dispatchFamily; subcommands are
    // resolved at runtime, not declared as static yargs children.
    expect(auditCommand.children).toBeUndefined();
    expect(auditCommand.handler).toBeDefined();
    expect(auditCommand.interactiveDefault).toBeDefined();
  });

  test('migrate is a flat command while only one vendor exists', () => {
    expect(migrateCommand.name).toBe('migrate');
    expect(migrateCommand.children).toBeUndefined();
  });

  test('revenue-analytics is a flat skill command', () => {
    expect(revenueCommand.name).toBe('revenue-analytics');
    expect(revenueCommand.children).toBeUndefined();
  });

  test('warehouse is a flat skill command', () => {
    expect(warehouseCommand.name).toBe('warehouse');
    expect(warehouseCommand.children).toBeUndefined();
  });

  test('audit exposes the shared skill options on the parent', () => {
    expect(auditCommand.options).toMatchObject({
      'install-dir': expect.any(Object),
    });
  });
});

describe('dispatchFamily', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('routes a skill-backed subcommand to runWizard with the resolved skillId', async () => {
    mockMenu([
      entry({
        skillId: 'audit-events',
        command: 'events',
        parentCommand: 'audit',
      }),
    ]);
    await dispatchFamily('audit', makeArgv({ skill: 'events', debug: true }));
    expect(mockRunWizard).toHaveBeenCalledTimes(1);
    expect(mockRunWizardCI).not.toHaveBeenCalled();
    const [config, opts] = mockRunWizard.mock.calls[0] as [
      { skillId?: string },
      Record<string, unknown>,
    ];
    expect(config.skillId).toBe('audit-events');
    expect(opts).toMatchObject({ debug: true });
  });

  test('routes through runWizardCI when --ci is set', async () => {
    mockMenu([
      entry({
        skillId: 'audit-events',
        command: 'events',
        parentCommand: 'audit',
      }),
    ]);
    await dispatchFamily('audit', makeArgv({ skill: 'events', ci: true }));
    expect(mockRunWizardCI).toHaveBeenCalledTimes(1);
    expect(mockRunWizard).not.toHaveBeenCalled();
  });

  test('runs the wizard-native handler for `audit web-analytics` without touching the registry', async () => {
    // fetchSkillMenu must not be reached for natives — verifies the native
    // override short-circuits before any network work.
    await dispatchFamily('audit', makeArgv({ skill: 'web-analytics' }));
    expect(mockFetchSkillMenu).not.toHaveBeenCalled();
    expect(mockRunWizard).toHaveBeenCalledTimes(1);
    const [config] = mockRunWizard.mock.calls[0] as [{ id?: string }];
    expect(config.id).toBe(webAnalyticsDoctorConfig.id);
  });

  test('the comprehensive `audit all` runs the specialized auditConfig, not agent-skill', async () => {
    // skillId 'audit' (what context-mill emits for `audit all`) signals
    // the wizard to use auditConfig (custom hooks, content blocks).
    mockMenu([
      entry({ skillId: 'audit', command: 'all', parentCommand: 'audit' }),
    ]);
    await dispatchFamily('audit', makeArgv({ skill: 'all' }));
    expect(mockRunWizard).toHaveBeenCalledTimes(1);
    const [config] = mockRunWizard.mock.calls[0] as [{ id?: string }];
    expect(config.id).toBe(auditConfig.id);
  });
});

describe('flat skill commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('migrate dispatches with migrate-statsig skillId', () => {
    migrateCommand.handler!(makeArgv({ installDir: '/tmp/some-app' }));
    const [config, opts] = mockRunWizard.mock.calls[0] as [
      { skillId?: string },
      Record<string, unknown>,
    ];
    expect(config.skillId).toBe('migrate-statsig');
    expect(opts.installDir).toBe('/tmp/some-app');
  });

  test('revenue-analytics dispatches with revenue-analytics-setup skillId', () => {
    revenueCommand.handler!(makeArgv({ debug: true }));
    const [config] = mockRunWizard.mock.calls[0] as [{ skillId?: string }];
    expect(config.skillId).toBe('revenue-analytics-setup');
  });

  test('warehouse dispatches with data-warehouse-source-setup skillId', () => {
    warehouseCommand.handler!(makeArgv({ installDir: '/tmp/some-app' }));
    const [config, opts] = mockRunWizard.mock.calls[0] as [
      { skillId?: string },
      Record<string, unknown>,
    ];
    expect(config.skillId).toBe('data-warehouse-source-setup');
    expect(opts.installDir).toBe('/tmp/some-app');
  });
});

describe('yargs parsing for the audit family', () => {
  test('camelCases --install-dir end-to-end', async () => {
    const argv = await parseCommand(
      auditCommand,
      'audit events --install-dir /tmp/app',
    );
    expect(argv.installDir).toBe('/tmp/app');
    expect(argv.skill).toBe('events');
  });

  test('parses audit web-analytics through yargs', async () => {
    const argv = await parseCommand(
      auditCommand,
      'audit web-analytics --install-dir /tmp/app',
    );
    expect(argv.installDir).toBe('/tmp/app');
    expect(argv.skill).toBe('web-analytics');
  });

  test('accepts upload-source-maps and legacy upload-sourcemaps alias', async () => {
    const canonical = await parseCommand(
      uploadSourcemapsCommand,
      'upload-source-maps --region eu',
    );
    const legacy = await parseCommand(
      uploadSourcemapsCommand,
      'upload-sourcemaps --region eu',
    );
    expect(canonical.region).toBe('eu');
    expect(legacy.region).toBe('eu');
  });
});

describe('pickerChildrenToShow (today: picker shows only the default leaf)', () => {
  const make = (name: string, isDefault?: boolean): Command => ({
    name,
    description: `${name} desc`,
    handler: () => undefined,
    ...(isDefault ? { default: true } : {}),
  });

  test('shows only the default-marked child when one exists', () => {
    const shown = pickerChildrenToShow([
      make('web-analytics'),
      make('events', true),
      make('all'),
      make('feature-flags'),
    ]);
    expect(shown.map((c) => c.name)).toEqual(['events']);
  });

  test('falls back to all children when none is marked default', () => {
    const shown = pickerChildrenToShow([make('events'), make('all')]);
    expect(shown.map((c) => c.name)).toEqual(['events', 'all']);
  });
});

describe('self-driving rejects unsupported modes', () => {
  // The guard lives in selfDrivingCommand.check, so it runs at the yargs layer
  // before the handler — parseCommand exercises that real path.
  test('rejects --signup', async () => {
    await expect(
      parseCommand(selfDrivingCommand, 'self-driving --signup'),
    ).rejects.toThrow(/--signup/i);
  });

  test('rejects --ci', async () => {
    await expect(
      parseCommand(selfDrivingCommand, 'self-driving --ci'),
    ).rejects.toThrow(/CI mode/i);
  });

  test('accepts a plain run', async () => {
    await expect(
      parseCommand(selfDrivingCommand, 'self-driving --install-dir /tmp/app'),
    ).resolves.toBeDefined();
  });
});
