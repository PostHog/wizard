import { basicIntegrationCommand } from '../commands/basic-integration';
import { parseCommand } from './helpers/parse-command.no-jest';

describe('basic-integration parsing (end-to-end yargs)', () => {
  test('parses flags into camelCased argv keys', async () => {
    const argv = await parseCommand(
      basicIntegrationCommand,
      '--api-key phx_x --install-dir /tmp/app',
    );
    expect(argv.apiKey).toBe('phx_x');
    expect(argv.installDir).toBe('/tmp/app');
  });

  test('rejects --playground with --ci', async () => {
    await expect(
      parseCommand(basicIntegrationCommand, '--ci --playground'),
    ).rejects.toThrow(/--playground cannot be combined/i);
  });

  // Default boolean values (ci/playground default false) must not register as
  // a spurious conflict when only one mode flag is actually passed.
  test.each(['', '--ci --api-key phx_x --install-dir /tmp', '--playground'])(
    'accepts a single mode: "%s"',
    async (args) => {
      await expect(
        parseCommand(basicIntegrationCommand, args),
      ).resolves.toBeDefined();
    },
  );
});
