import { auditCommand } from '../commands/audit';
import { aiObservabilityCommand } from '../commands/ai-observability';
import { basicIntegrationCommand } from '../commands/basic-integration';
import { revenueCommand } from '../commands/revenue';
import { HEADLESS_FLAG } from '../lib/headless-mode';
import { GLOBAL_OPTIONS } from '../wizard';
import { parseCommand } from './helpers/parse-command.no-jest';

// Headless support is opt-in because each command must work without prompts.
// These tests prevent the flag from becoming global or leaking onto a command
// that has not implemented non-interactive execution.
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

  test('is declared on the AI Observability command', () => {
    expect(aiObservabilityCommand.options).toHaveProperty(HEADLESS_FLAG);
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

  test('AI Observability parses cloud-run flags (end-to-end yargs)', async () => {
    const argv = await parseCommand(
      aiObservabilityCommand,
      `ai-observability --${HEADLESS_FLAG} --region us --api-key pha_x --install-dir /tmp/app`,
    );
    expect(argv[HEADLESS_FLAG]).toBe(true);
    expect(argv.region).toBe('us');
  });
});
