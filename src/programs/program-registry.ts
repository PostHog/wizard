/**
 * Central registry of all wizard programs. A program is an agent run; a
 * command that runs no agent is a tool, in `src/tools`. To add one, follow
 * "Add a program" in README.md in this folder, then import it here.
 */

import type { ProgramConfig, ProgramId } from './program-step.js';
import {
  WIZARD_OAUTH_SCOPES,
  WIZARD_PROVISIONING_SCOPES,
} from '@shared/constants';
import { withScopeAdditions } from '@shared/oauth-scopes';
import { config as posthogIntegration } from '@programs/posthog-integration';
import { config as mcpAnalytics } from '@programs/mcp-analytics';
import { config as replayVision } from '@programs/replay-vision';
import { config as aiObservability } from '@programs/ai-observability';
import { config as metrics } from '@programs/metrics';
import { configs as auditPrograms } from '@programs/audit';
import { config as webAnalyticsDoctor } from '@programs/web-analytics-doctor';
import { config as migration } from '@programs/migration';
import { config as revenueAnalytics } from '@programs/revenue-analytics';
import { config as warehouseSource } from '@programs/warehouse-source';
import { config as selfDriving } from '@programs/self-driving';
import { config as sourceMaps } from '@programs/error-tracking-upload-source-maps';
import { config as errorTracking } from '@programs/error-tracking';
import { config as agentSkill } from '@programs/agent-skill';

const [audit, eventsAudit] = auditPrograms;

/** Every program entry, one line each. */
export const PROGRAM_REGISTRY = [
  posthogIntegration,
  revenueAnalytics,
  warehouseSource,
  sourceMaps,
  errorTracking,
  ...auditPrograms,
  webAnalyticsDoctor,
  migration,
  selfDriving,
  agentSkill,
  mcpAnalytics,
  replayVision,
  aiObservability,
  metrics,
] as const satisfies readonly ProgramConfig[];

/**
 * Typed program names. Values come from each config's `id`, so there's
 * no parallel string list to keep in sync — adding `Program.Foo` here is
 * just exposing that config's `id` under a friendly name for call sites.
 */
export const Program = {
  PostHogIntegration: posthogIntegration.id,
  RevenueAnalyticsSetup: revenueAnalytics.id,
  WarehouseSource: warehouseSource.id,
  ErrorTrackingUploadSourceMaps: sourceMaps.id,
  ErrorTracking: errorTracking.id,
  Migration: migration.id,
  Audit: audit.id,
  EventsAudit: eventsAudit.id,
  WebAnalyticsDoctor: webAnalyticsDoctor.id,
  SelfDriving: selfDriving.id,
  AgentSkill: agentSkill.id,
  McpAnalytics: mcpAnalytics.id,
  ReplayVision: replayVision.id,
  AiObservability: aiObservability.id,
  Metrics: metrics.id,
} as const;

/**
 * Look up a program config by its id. Callers pass ids from `Program` or
 * from a registered config.
 */
export function getProgramConfig(id: ProgramId): ProgramConfig {
  const config = PROGRAM_REGISTRY.find((c) => c.id === id);
  if (!config) throw new Error(`Unknown program id "${id}"`);
  return config;
}

/** A program config that is exposed as a CLI subcommand. */
export type SubcommandProgram = ProgramConfig & { command: string };

/** All program configs that are exposed as CLI subcommands. */
export function getSubcommandPrograms(): SubcommandProgram[] {
  return PROGRAM_REGISTRY.filter(
    (c): c is SubcommandProgram => c.command != null,
  );
}

/** What a user types to reach a command. Nested ones go through its parent. */
export function getCommandPath(config: {
  command: string;
  parentCommand?: string;
}): string {
  return config.parentCommand
    ? `${config.parentCommand} ${config.command}`
    : config.command;
}

/** The program with this id, or undefined for a tool's id or none. */
export function findProgramConfig(
  programId: ProgramId | null | undefined,
): ProgramConfig | undefined {
  return programId
    ? PROGRAM_REGISTRY.find((c) => c.id === programId)
    : undefined;
}

/**
 * The OAuth scopes a program's login asks for: `WIZARD_OAUTH_SCOPES` plus
 * the program's `oauthScopeAdditions`. A missing or unknown id gets the base
 * set unchanged.
 */
export function getOAuthScopesForProgram(
  programId: ProgramId | null | undefined,
): readonly string[] {
  return withScopeAdditions(
    WIZARD_OAUTH_SCOPES,
    findProgramConfig(programId)?.oauthScopeAdditions,
  );
}

/**
 * The scopes for the signup provisioning path. Same shape as
 * `getOAuthScopesForProgram`, on `WIZARD_PROVISIONING_SCOPES`, so a
 * program's extra scopes only reach tokens provisioned for that program.
 */
export function getProvisioningScopesForProgram(
  programId: ProgramId | null | undefined,
): readonly string[] {
  return withScopeAdditions(
    WIZARD_PROVISIONING_SCOPES,
    findProgramConfig(programId)?.oauthScopeAdditions,
  );
}
