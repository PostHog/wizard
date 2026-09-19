#!/usr/bin/env node
import { satisfies } from 'semver';
import { Agent, setGlobalDispatcher } from 'undici';
import { ErrorCodes } from '@store/shared/errors/codes';
import { emitWizardError } from '@store/shared/errors/emit';

// Keep in sync with `engines.node` in package.json. npx does not enforce
// engines, so this preflight is the only thing standing between an old Node
// runtime and a cryptic dependency crash (e.g. undici's markAsUncloneable
// TypeError on Node < 22.10).
const NODE_VERSION_RANGE = '>=22.22.0';

/*
 * TODO(#1198): remove when fetch over HTTP/2 is safe on Node 26. Remove when all
 * of these are true:
 *  - nodejs/node no longer creates an orphan ClientHttp2Stream when a client
 *    session gets HEADERS for a stream id it already reset. Repro: abort a fetch
 *    before its response headers, then idle 4s on Node 26. Fixed when the
 *    process survives.
 *  - modelcontextprotocol/typescript-sdk#2526 is closed.
 *  - pi-coding-agent's CLI drops `allowH2: false` from its http-dispatcher.
 * Same workaround as pi's CLI and typescript-sdk#2526: HTTP/1.1 only.
 */
setGlobalDispatcher(new Agent({ allowH2: false }));

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

import { Wizard } from './src/cli/wizard.js';
import { basicIntegrationCommand } from './src/cli/commands/basic-integration/index.js';
import { mcpCommand } from './src/cli/commands/mcp/index.js';
import { mcpAnalyticsCommand } from './src/cli/commands/mcp-analytics.js';
import { replayVisionCommand } from './src/cli/commands/replay-vision.js';
import { aiObservabilityCommand } from './src/cli/commands/ai-observability.js';
import { metricsCommand } from './src/cli/commands/metrics.js';
import { auditCommand } from './src/cli/commands/audit.js';
import { doctorCommand } from './src/cli/commands/doctor.js';
import { migrateCommand } from './src/cli/commands/migrate.js';
import { revenueCommand } from './src/cli/commands/revenue.js';
import { warehouseCommand } from './src/cli/commands/warehouse.js';
import { selfDrivingCommand } from './src/cli/commands/self-driving.js';
import { slackCommand } from './src/cli/commands/slack.js';
import { uploadSourcemapsCommand } from './src/cli/commands/upload-sourcemaps.js';
import { errorTrackingCommand } from './src/cli/commands/error-tracking.js';
import { skillCommand } from './src/cli/commands/skill.js';
import { cliCommand } from './src/cli/commands/cli/index.js';
import { recoverOrphanedSettingsBackups } from '@store/services/claude-settings';
import { setUI } from '@store/ui';
import { LoggingUI } from '@tui/console/logging-ui';

// The entry point owns the default renderer; @ui ships with none.
setUI(new LoggingUI());

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
  .use(errorTrackingCommand)
  .use(skillCommand)
  .init();
