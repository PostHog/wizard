/**
 * Central registry of all wizard programs.
 *
 * Adding a new program:
 *   1. Create src/lib/programs/<name>/ with index.ts exporting a ProgramConfig
 *   2. Import and add it to PROGRAM_REGISTRY below
 *   3. (If custom intro screen) add to src/ui/tui/screen-registry.tsx
 *
 * screen-sequences.ts, store.ts, and bin.ts all derive their wiring from
 * this array — no need to touch those files when adding a program.
 */

import type { ProgramConfig } from './program-step.js';
import { posthogIntegrationConfig } from './posthog-integration/index.js';
import { revenueAnalyticsConfig } from './revenue-analytics/index.js';
import { auditConfig } from './audit/index.js';
import { eventsAuditConfig } from './events-audit/index.js';
import { audit3000Config } from './audit-3000/index.js';
import { posthogDoctorConfig } from './posthog-doctor/index.js';
import { migrationConfig } from './migration/index.js';
import { errorTrackingUploadSourceMapsConfig } from './error-tracking-upload-source-maps/index.js';
import { AGENT_SKILL_STEPS } from './agent-skill/index.js';
import { getContentBlocks as agentSkillContentBlocks } from './agent-skill/content/index.js';
import { mcpAddConfig, mcpRemoveConfig } from './mcp/index.js';

// Generic skill program — invoked when the wizard runs an arbitrary
// context-mill skill chosen at runtime (session.skillId) rather than a
// registered named program. No CLI command, no run config.
const agentSkillConfig: ProgramConfig = {
  id: 'agent-skill',
  description: 'Run an arbitrary context-mill skill',
  steps: AGENT_SKILL_STEPS,
  getContentBlocks: agentSkillContentBlocks,
  allowedTools: ['Agent'],
};

export const PROGRAM_REGISTRY = [
  posthogIntegrationConfig,
  revenueAnalyticsConfig,
  errorTrackingUploadSourceMapsConfig,
  auditConfig,
  eventsAuditConfig,
  audit3000Config,
  posthogDoctorConfig,
  migrationConfig,
  agentSkillConfig,
  mcpAddConfig,
  mcpRemoveConfig,
] as const satisfies readonly ProgramConfig[];

/**
 * Typed program names. Values come from each config's `id`, so there's
 * no parallel string list to keep in sync — adding `Program.Foo` here is
 * just exposing `fooConfig.id` under a friendly name for call sites.
 */
export const Program = {
  PostHogIntegration: posthogIntegrationConfig.id,
  RevenueAnalyticsSetup: revenueAnalyticsConfig.id,
  ErrorTrackingUploadSourceMaps: errorTrackingUploadSourceMapsConfig.id,
  Migration: migrationConfig.id,
  Audit: auditConfig.id,
  EventsAudit: eventsAuditConfig.id,
  Audit3000: audit3000Config.id,
  PosthogDoctor: posthogDoctorConfig.id,
  AgentSkill: agentSkillConfig.id,
  McpAdd: mcpAddConfig.id,
  McpRemove: mcpRemoveConfig.id,
} as const;

/** Compile-time union of every registered program id. */
export type ProgramId = (typeof PROGRAM_REGISTRY)[number]['id'];

/**
 * Look up a program config by its id. `ProgramId` is a union of every
 * registered id, so the lookup is statically guaranteed to find a match
 * — the `!` is a load-bearing assertion of that invariant, not a hope.
 */
export function getProgramConfig(id: ProgramId): ProgramConfig {
  return PROGRAM_REGISTRY.find((c) => c.id === id)!;
}

/** All program configs that are exposed as CLI subcommands. */
export function getSubcommandPrograms(): ProgramConfig[] {
  return PROGRAM_REGISTRY.filter((c) => c.command != null);
}
