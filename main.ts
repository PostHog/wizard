import { Agent, setGlobalDispatcher } from 'undici';

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

import { Wizard } from './src/cli/wizard';
import { basicIntegrationCommand } from './src/cli/commands/basic-integration';
import { mcpCommand } from './src/cli/commands/mcp';
import { mcpAnalyticsCommand } from './src/cli/commands/mcp-analytics';
import { replayVisionCommand } from './src/cli/commands/replay-vision';
import { aiObservabilityCommand } from './src/cli/commands/ai-observability';
import { metricsCommand } from './src/cli/commands/metrics';
import { auditCommand } from './src/cli/commands/audit';
import { doctorCommand } from './src/tools/doctor/report';
import { migrateCommand } from './src/cli/commands/migrate';
import { revenueCommand } from './src/cli/commands/revenue';
import { warehouseCommand } from './src/cli/commands/warehouse';
import { selfDrivingCommand } from './src/cli/commands/self-driving';
import { uploadSourcemapsCommand } from './src/cli/commands/upload-sourcemaps';
import { errorTrackingCommand } from './src/cli/commands/error-tracking';
import { skillCommand } from './src/cli/commands/skill';
import { cliCommand } from './src/cli/commands/cli';
import { recoverOrphanedSettingsBackups } from '@shared/claude-settings';

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
  .use(uploadSourcemapsCommand)
  .use(errorTrackingCommand)
  .use(skillCommand)
  .init();
