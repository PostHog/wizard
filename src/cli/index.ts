/** The CLI's one entry: `main.ts` runs the `wizard` command line through it. */
import { Wizard } from './wizard';
import { basicIntegrationCommand } from './commands/basic-integration';
import { mcpCommand } from './commands/mcp';
import { mcpAnalyticsCommand } from './commands/mcp-analytics';
import { replayVisionCommand } from './commands/replay-vision';
import { aiObservabilityCommand } from './commands/ai-observability';
import { metricsCommand } from './commands/metrics';
import { cliCommand } from './commands/cli';
import { auditCommand } from './commands/audit';
import { doctorCommand } from './commands/doctor';
import { migrateCommand } from './commands/migrate';
import { revenueCommand } from './commands/revenue';
import { warehouseCommand } from './commands/warehouse';
import { selfDrivingCommand } from './commands/self-driving';
import { slackCommand } from './commands/slack';
import { uploadSourcemapsCommand } from './commands/upload-sourcemaps';
import { errorTrackingCommand } from './commands/error-tracking';
import { skillCommand } from './commands/skill';

/** Register every command and run the one `process.argv` names. */
export function runCli(): void {
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
}
