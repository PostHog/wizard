import { skillCommand } from '../commands/skill';
import { parseCommand } from './helpers/parse-command.no-jest';

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
      /not enough non-option arguments/i,
    );
  });
});
