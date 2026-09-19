/**
 * Composition root: installs the default renderer and the agent seams, then
 * registers every command and hands argv to yargs. bin.ts imports this after
 * its Node preflight.
 */
import {
  setUI,
  setDetectionAgent,
  setMcpPromptRunner,
  recoverOrphanedSettingsBackups,
} from '@store';
import { Wizard } from './wizard.js';
import { basicIntegrationCommand } from './commands/basic-integration/index.js';
import { mcpCommand } from './commands/mcp/index.js';
import { mcpAnalyticsCommand } from './commands/mcp-analytics.js';
import { replayVisionCommand } from './commands/replay-vision.js';
import { aiObservabilityCommand } from './commands/ai-observability.js';
import { metricsCommand } from './commands/metrics.js';
import { auditCommand } from './commands/audit.js';
import { doctorCommand } from './commands/doctor.js';
import { migrateCommand } from './commands/migrate.js';
import { revenueCommand } from './commands/revenue.js';
import { warehouseCommand } from './commands/warehouse.js';
import { selfDrivingCommand } from './commands/self-driving.js';
import { slackCommand } from './commands/slack.js';
import { uploadSourcemapsCommand } from './commands/upload-sourcemaps.js';
import { errorTrackingCommand } from './commands/error-tracking.js';
import { skillCommand } from './commands/skill.js';
import { cliCommand } from './commands/cli/index.js';
import { LoggingUI } from '@tui/console';

// The entry point owns the default renderer; @ui ships with none.
setUI(new LoggingUI());
// The store and the TUI never import the agent; the entry point installs it,
// lazily, so `--version` and `--help` never load the SDK or Ink.
setDetectionAgent(async (session, options) => {
  const { detectProjectsWithAgent } = await import('@agent');
  return detectProjectsWithAgent(session, options);
});
setMcpPromptRunner({
  runMcpPrompt: async function* (args) {
    const { runMcpPromptViaSdk } = await import('@agent');
    yield* runMcpPromptViaSdk(args);
  },
});

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
