import type { Arguments } from 'yargs';

vi.mock('../commands/basic-integration/skill.js', () => ({
  runSkillMode: vi.fn(),
}));

vi.mock('@store/tools/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@store/tools/tools')>();
  return { ...actual, fetchSkillMenu: vi.fn() };
});

import { runSkillMode } from '../commands/basic-integration/skill.js';
import { fetchSkillMenu } from '@store/tools/tools';
import { analytics } from '@store/shared/analytics';
import { skillCommand } from '../commands/skill.js';
import { parseCommand } from './helpers/parse-command.no-jest.js';

function makeArgv(extra: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extra } as Arguments;
}

/** A skill menu whose flattened categories contain exactly `ids`. */
function menuWith(...ids: string[]) {
  return {
    categories: {
      audit: ids.map((id) => ({ id, name: id, downloadUrl: '' })),
    },
  };
}

/** Drain the microtask queue so the handler's fire-and-forget work settles. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('skill command parsing (end-to-end yargs)', () => {
  test('parses the skill name positional', async () => {
    const argv = await parseCommand(skillCommand, 'skill audit-events');
    expect(argv.skillName).toBe('audit-events');
  });

  test('accepts --ci for a headless run', async () => {
    const argv = await parseCommand(skillCommand, 'skill audit-events --ci');
    expect(argv.skillName).toBe('audit-events');
    expect(argv.ci).toBe(true);
  });

  test('accepts --install-dir', async () => {
    const argv = await parseCommand(
      skillCommand,
      'skill audit-events --install-dir /tmp/app',
    );
    expect(argv.installDir).toBe('/tmp/app');
  });

  test('rejects a bare `skill` with no skill name', async () => {
    await expect(parseCommand(skillCommand, 'skill')).rejects.toThrow(
      /not enough non-option arguments|skill name/i,
    );
  });
});

describe('skill command validation', () => {
  test('rejects an empty / whitespace skill name', () => {
    expect(() => skillCommand.check!(makeArgv({ skillName: '   ' }))).toThrow(
      /skill name/i,
    );
  });

  test('accepts a non-empty skill name', () => {
    expect(skillCommand.check!(makeArgv({ skillName: 'audit-events' }))).toBe(
      true,
    );
  });
});

describe('skill command handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the registry knows `audit-events`, so validation passes.
    (fetchSkillMenu as Mock).mockResolvedValue(menuWith('audit-events'));
  });

  test('bridges the positional onto runSkillMode as the skill id', async () => {
    skillCommand.handler!(makeArgv({ skillName: 'audit-events', ci: false }));
    await flush();
    expect(runSkillMode).toHaveBeenCalledTimes(1);
    const passed = (runSkillMode as Mock).mock.calls[0][0];
    expect(passed.skill).toBe('audit-events');
  });

  test('trims surrounding whitespace from the skill id', async () => {
    skillCommand.handler!(makeArgv({ skillName: '  audit-events  ' }));
    await flush();
    const passed = (runSkillMode as Mock).mock.calls[0][0];
    expect(passed.skill).toBe('audit-events');
  });

  test('runs the skill anyway when the registry is unreachable', async () => {
    (fetchSkillMenu as Mock).mockResolvedValue(null);
    skillCommand.handler!(makeArgv({ skillName: 'audit-events' }));
    await flush();
    expect(runSkillMode).toHaveBeenCalledTimes(1);
  });

  test('rejects an unknown skill id before running (no runSkillMode call)', async () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    vi.spyOn(analytics, 'wizardCapture').mockImplementation(() => undefined);
    vi.spyOn(analytics, 'flush').mockResolvedValue(undefined);

    skillCommand.handler!(makeArgv({ skillName: 'does-not-exist' }));
    await flush();

    expect(runSkillMode).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(String((stderr.mock.calls[0] ?? [''])[0])).toMatch(/unknown skill/i);

    exit.mockRestore();
    stderr.mockRestore();
  });
});
