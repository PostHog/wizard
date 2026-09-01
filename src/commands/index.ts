/**
 * Every command the CLI registers, in the order `--help` lists them.
 *
 * Kept here rather than inline in bin.ts so registration and the tests that
 * check it read from the same list — a program can otherwise advertise a
 * command that no longer exists, and nothing catches it.
 */

import type { Command } from './command';
import { basicIntegrationCommand } from './basic-integration';
import { mcpCommand } from './mcp';
import { mcpAnalyticsCommand } from './mcp-analytics';
import { replayVisionCommand } from './replay-vision';
import { aiObservabilityCommand } from './ai-observability';
import { metricsCommand } from './metrics';
import { cliCommand } from './cli';
import { auditCommand } from './audit';
import { doctorCommand } from './doctor';
import { migrateCommand } from './migrate';
import { revenueCommand } from './revenue';
import { warehouseCommand } from './warehouse';
import { selfDrivingCommand } from './self-driving';
import { slackCommand } from './slack';
import { uploadSourcemapsCommand } from './upload-sourcemaps';
import { skillCommand } from './skill';

export const ALL_COMMANDS: readonly Command[] = [
  basicIntegrationCommand,
  mcpCommand,
  mcpAnalyticsCommand,
  replayVisionCommand,
  aiObservabilityCommand,
  metricsCommand,
  cliCommand,
  auditCommand,
  doctorCommand,
  migrateCommand,
  revenueCommand,
  warehouseCommand,
  selfDrivingCommand,
  slackCommand,
  uploadSourcemapsCommand,
  skillCommand,
];
