import type { Arguments } from 'yargs';

vi.mock('../commands/basic-integration/skill', () => ({
  runSkillMode: vi.fn(),
}));

import { runSkillMode } from '../commands/basic-integration/skill';
import { skillCommand } from '../commands/skill';
import { parseCommand } from './helpers/parse-command.no-jest';

function makeArgv(extra: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extra } as Arguments;
}

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
  beforeEach(() => vi.clearAllMocks());

  test('bridges the positional onto runSkillMode as the skill id', () => {
    skillCommand.handler!(makeArgv({ skillName: 'audit-events', ci: false }));
    expect(runSkillMode).toHaveBeenCalledTimes(1);
    const passed = (runSkillMode as Mock).mock.calls[0][0];
    expect(passed.skill).toBe('audit-events');
  });

  test('trims surrounding whitespace from the skill id', () => {
    skillCommand.handler!(makeArgv({ skillName: '  audit-events  ' }));
    const passed = (runSkillMode as Mock).mock.calls[0][0];
    expect(passed.skill).toBe('audit-events');
  });
});
