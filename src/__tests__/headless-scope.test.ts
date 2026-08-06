import { auditCommand } from '../commands/audit';
import { basicIntegrationCommand } from '../commands/basic-integration';
import { revenueCommand } from '../commands/revenue';
import { HEADLESS_FLAG } from '../lib/headless-mode';
import { GLOBAL_OPTIONS } from '../wizard';
import { parseCommand } from './helpers/parse-command.no-jest';

// The experimental headless flag is scoped to exactly two surfaces — the base
// integration flow (`wizard`) and `wizard audit` — rather than being a global
// flag. These tests pin that scope so a future change can't silently re-globalise
// it or leak it onto another command.
describe('headless flag scope', () => {
  test('is not a global option', () => {
    expect(GLOBAL_OPTIONS).not.toHaveProperty(HEADLESS_FLAG);
  });

  test('is declared on the base integration command', () => {
    expect(basicIntegrationCommand.options).toHaveProperty(HEADLESS_FLAG);
  });

  test('is declared on the audit command', () => {
    expect(auditCommand.options).toHaveProperty(HEADLESS_FLAG);
  });

  test('is NOT declared on an unrelated native command', () => {
    expect(revenueCommand.options ?? {}).not.toHaveProperty(HEADLESS_FLAG);
  });

  test('audit parses the flag under its declared key (end-to-end yargs)', async () => {
    const argv = await parseCommand(
      auditCommand,
      `audit events --${HEADLESS_FLAG} --api-key pha_x --install-dir /tmp/app`,
    );
    expect(argv.skill).toBe('events');
    expect(argv[HEADLESS_FLAG]).toBe(true);
  });
});
