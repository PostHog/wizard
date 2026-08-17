import { basicIntegrationCommand } from '../commands/basic-integration';
import { HEADLESS_FLAG } from '../lib/headless-mode';
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

  test('parses the experimental headless flag under its declared key', async () => {
    const argv = await parseCommand(
      basicIntegrationCommand,
      `--${HEADLESS_FLAG} --api-key pha_x --install-dir /tmp/app`,
    );
    // yargs always sets the value under the declared (kebab) key.
    expect(argv[HEADLESS_FLAG]).toBe(true);
  });

  test.each(['--ci --playground', `--${HEADLESS_FLAG} --playground`])(
    'rejects --playground with a non-interactive flag: "%s"',
    async (args) => {
      await expect(parseCommand(basicIntegrationCommand, args)).rejects.toThrow(
        /--playground cannot be combined/i,
      );
    },
  );

  // Default boolean values (ci/headless/playground default false) must not
  // register as a spurious conflict when only one mode flag is actually passed.
  test.each([
    '',
    '--ci --api-key phx_x --install-dir /tmp',
    `--${HEADLESS_FLAG} --api-key pha_x --install-dir /tmp`,
    '--playground',
  ])('accepts a single mode: "%s"', async (args) => {
    await expect(
      parseCommand(basicIntegrationCommand, args),
    ).resolves.toBeDefined();
  });
});
