#!/usr/bin/env node
import { satisfies } from 'semver';
import { ErrorCodes } from './src/lib/errors/codes.js';
import { emitWizardError } from './src/lib/errors/emit.js';

// Keep in sync with `engines.node` in package.json. npx does not enforce
// engines, so this preflight is the only thing standing between an old Node
// runtime and a cryptic dependency crash (e.g. undici's markAsUncloneable
// TypeError on Node < 22.10).
const NODE_VERSION_RANGE = '>=22.22.0';

// Have to run this above the other imports because they are importing clack that
// has the problematic imports.
if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  // eslint-disable-next-line no-console
  console.log(
    [
      `The PostHog wizard needs a newer version of Node.js to run.`,
      ``,
      `  You have:  ${process.version}`,
      `  You need:  v${NODE_VERSION_RANGE.replace('>=', '')} or later`,
      ``,
      `To update Node.js:`,
      ``,
      `  Download the latest version from https://nodejs.org/en/download`,
      `  Or, if you use nvm, run: nvm install 22 && nvm use 22`,
      ``,
      `Then run the wizard again. Stuck? Email wizard@posthog.com and we'll help.`,
    ].join('\n'),
  );
  emitWizardError({
    code: ErrorCodes.CliNodeVersion,
    message: `Node ${process.version} is below the required range ${NODE_VERSION_RANGE}`,
  });
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
import { mcpAnalyticsCommand } from './src/commands/mcp-analytics';
import { replayVisionCommand } from './src/commands/replay-vision';
import { aiObservabilityCommand } from './src/commands/ai-observability';
import { metricsCommand } from './src/commands/metrics';
import { auditCommand } from './src/commands/audit';
import { doctorCommand } from './src/commands/doctor';
import { migrateCommand } from './src/commands/migrate';
import { revenueCommand } from './src/commands/revenue';
import { warehouseCommand } from './src/commands/warehouse';
import { selfDrivingCommand } from './src/commands/self-driving';
import { slackCommand } from './src/commands/slack';
import { uploadSourcemapsCommand } from './src/commands/upload-sourcemaps';
import { skillCommand } from './src/commands/skill';
import { cliCommand } from './src/commands/cli';
import { recoverOrphanedSettingsBackups } from './src/lib/agent/claude-settings';
import { releaseTerminal } from './src/ui/tui/terminal';
import { runCleanups } from './src/utils/wizard-abort';

// Last-resort net for any error no local handler caught. A TUI command may
// already own the alt screen, so leave it, print a readable line, and exit —
// otherwise the user is stranded on a blank screen with the real error lost in
// the discarded alt buffer. Node already terminates on these events; this only
// makes the exit clean.
function handleFatal(err: unknown): void {
  releaseTerminal();
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`\n\x1b[1;91m✖ The PostHog wizard crashed: ${message}\x1b[0m\n`);
  emitWizardError({ code: ErrorCodes.InternalUnhandled, message });
  // Run registered cleanups before exiting, same as wizardAbort() and the
  // runner catch/signal paths — a fatal event otherwise skips them, leaving
  // state a cleanup owns unrestored (e.g. the backed-up .claude/settings.json
  // that backupAndFixClaudeSettings deletes and registers a restore for).
  runCleanups();
  process.exit(1);
}
// Skip under test: the CLI suites import bin.ts and mock process.exit to throw,
// so a global handler would turn every mocked exit into a worker crash. Prod
// builds inline NODE_ENV as 'production', so the net is always live for users.
if (process.env.NODE_ENV !== 'test') {
  process.on('unhandledRejection', handleFatal);
  process.on('uncaughtException', handleFatal);
}

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
  .use(mcpAnalyticsCommand)
  .use(replayVisionCommand)
  .use(aiObservabilityCommand)
  .use(metricsCommand)
  .use(cliCommand)
  .use(auditCommand)
  .use(doctorCommand)
  .use(migrateCommand)
  .use(revenueCommand)
  .use(warehouseCommand)
  .use(selfDrivingCommand)
  .use(slackCommand)
  .use(uploadSourcemapsCommand)
  .use(skillCommand)
  .init();
