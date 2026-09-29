/**
 * Central registry of all wizard programs. A program is an agent run; a
 * command that runs no agent is a tool, in `src/tools`.
 *
 * Adding a new program:
 *   1. Create src/programs/<name>/ with index.ts exporting its ProgramConfig
 *      as `config` (an entry that registers several exports `configs`), and a
 *      tsconfig.json copied from a sibling. List it in `references` in
 *      src/programs/tsconfig.json, or `pnpm typecheck` fails at this file's
 *      import with TS6307
 *   2. Import it here as `@programs/<name>` and add it to PROGRAM_REGISTRY.
 *      Add its id to the intro's list (`introEntries` in
 *      src/tui/programs/posthog-integration/intro-menu.ts) only when the
 *      intro hands off to it
 *   3. Give it a screen flow in src/tui/programs/<name>/, with its own
 *      tsconfig.json (list it in src/tui/tsconfig.json), and import and spread it in
 *      src/tui/programs/index.ts (a skill program can use the default flow)
 *   4. A team-owned program: add both folders to .github/CODEOWNERS and the
 *      README table that mirrors it
 *   5. A custom command only: its file in src/cli/commands/ and its entry in
 *      CUSTOM_COMMANDS in src/cli/commands/index.ts
 *   An e2e test definition, if any, is src/programs/<name>/test/e2e.json; the
 *   harness finds it by its `program` field. See README.md in this folder.
 *
 * The CLI commands, the TUI's screen sequences, the OAuth scopes and the
 * detect error codes derive from this array. Programs are imported through
 * their `@programs/<name>` entry only: the layer check rejects a deep import.
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

/**
 * Every program entry, one line each. The order is the order `wizard --help`
 * lists the programs' commands in (see `src/cli/commands/index.ts`).
 */
export const PROGRAM_REGISTRY = [
  posthogIntegration,
  mcpAnalytics,
  replayVision,
  aiObservability,
  metrics,
  ...auditPrograms,
  webAnalyticsDoctor,
  migration,
  revenueAnalytics,
  warehouseSource,
  selfDriving,
  sourceMaps,
  errorTracking,
  agentSkill,
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
  return PROGRAM_REGISTRY.find((c) => c.id === id)!;
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
