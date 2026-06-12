#!/usr/bin/env node
import { satisfies } from 'semver';

const NODE_VERSION_RANGE = '>=18.17.0';

// Have to run this above the other imports because they are importing clack that
// has the problematic imports.
if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  // eslint-disable-next-line no-console
  console.log(
    `PostHog wizard requires Node.js ${NODE_VERSION_RANGE}. You are using Node.js ${process.version}. Please upgrade your Node.js version.`,
  );
  process.exit(1);
}

// Test mock server — only loaded when NODE_ENV is 'test'.
// In production builds, tsdown replaces process.env.NODE_ENV with 'production',
// making this block dead code.
if (process.env.NODE_ENV === 'test') {
  void (async () => {
    try {
      const { server } = await import('./e2e-tests/mocks/server.js');
      server.listen({
        onUnhandledRequest: 'bypass',
      });
    } catch (error) {
      // Mock server import failed - this can happen during non-E2E tests
    }
  })();
}

import { Wizard } from './src/wizard';
import { basicIntegrationCommand } from './src/commands/basic-integration';
import { mcpCommand } from './src/commands/mcp';
import { auditCommand } from './src/commands/audit';
import { doctorCommand } from './src/commands/doctor';
import { migrateCommand } from './src/commands/migrate';
import { revenueCommand } from './src/commands/revenue';
import { uploadSourcemapsCommand } from './src/commands/upload-sourcemaps';
import { skillCommand } from './src/commands/skill';
import { recoverOrphanedSettingsBackups } from './src/lib/agent/claude-settings';

// Heal any .claude/settings backup a previous interrupted run left orphaned,
// before anything else reads Claude settings — conflict detection, OAuth, and
// the agent all need to see the user's real settings file. The install dir is
// read directly from argv/env because yargs hasn't parsed yet.
recoverOrphanedSettingsBackups(resolveInstallDir());

function resolveInstallDir(): string {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf('--install-dir');
  if (flagIndex !== -1 && args[flagIndex + 1]) return args[flagIndex + 1];
  const inline = args.find((a) => a.startsWith('--install-dir='));
  if (inline) return inline.slice('--install-dir='.length);
  return process.env.POSTHOG_WIZARD_INSTALL_DIR ?? process.cwd();
}

Wizard.use(basicIntegrationCommand)
  .use(mcpCommand)
  .use(auditCommand)
  .use(doctorCommand)
  .use(migrateCommand)
  .use(revenueCommand)
  .use(uploadSourcemapsCommand)
  .use(skillCommand)
  .init();
