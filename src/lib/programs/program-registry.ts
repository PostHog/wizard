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
import { POSTHOG_DOCS_URL } from '../constants.js';
import { posthogIntegrationConfig } from './posthog-integration/index.js';
import { revenueAnalyticsConfig } from './revenue-analytics/index.js';
import { warehouseSourceConfig } from './warehouse-source/index.js';
import { auditConfig } from './audit/index.js';
import { eventsAuditConfig } from './events-audit/index.js';
import { posthogDoctorConfig } from './posthog-doctor/index.js';
import { webAnalyticsDoctorConfig } from './web-analytics-doctor/index.js';
import { migrationConfig } from './migration/index.js';
import { errorTrackingUploadSourceMapsConfig } from './error-tracking-upload-source-maps/index.js';
import { selfDrivingConfig } from './self-driving/index.js';
import { AGENT_SKILL_STEPS } from './agent-skill/index.js';
import { getContentBlocks as agentSkillContentBlocks } from './agent-skill/content/index.js';
import {
  mcpAddConfig,
  mcpRemoveConfig,
  mcpTutorialConfig,
} from './mcp/index.js';
import { slackConnectConfig } from './slack/index.js';

// Generic skill program — runs an arbitrary context-mill skill chosen at
// dispatch time (session.skillId) rather than a registered named program.
// Backs `wizard skill <name>` and the narrow `audit` leaves (events,
// feature-flags, identify, session-replay, autocapture); each injects its
// skillId onto the config, which lands on session.skillId before the run.
//
// The `run` recipe is a function rather than a static block because the
// skillId isn't known until dispatch. Without a `run` recipe the runner's
// `skipAgent` guard (run-wizard.ts) fires and the skill never executes — so we
// derive generic run metadata from the resolved skill id at run time.
export const agentSkillConfig: ProgramConfig = {
  id: 'agent-skill',
  description: 'Run an arbitrary context-mill skill',
  steps: AGENT_SKILL_STEPS,
  getContentBlocks: agentSkillContentBlocks,
  allowedTools: ['Agent'],
  run: (session) => {
    const skillId = session.skillId ?? 'agent-skill';
    return Promise.resolve({
      skillId,
      integrationLabel: skillId,
      spinnerMessage: `Running ${skillId}...`,
      successMessage: `${skillId} complete!`,
      estimatedDurationMinutes: 5,
      reportFile: `posthog-${skillId}-report.md`,
      docsUrl: POSTHOG_DOCS_URL,
    });
  },
};

export const PROGRAM_REGISTRY = [
  posthogIntegrationConfig,
  revenueAnalyticsConfig,
  warehouseSourceConfig,
  errorTrackingUploadSourceMapsConfig,
  auditConfig,
  eventsAuditConfig,
  posthogDoctorConfig,
  webAnalyticsDoctorConfig,
  migrationConfig,
  selfDrivingConfig,
  agentSkillConfig,
  mcpAddConfig,
  mcpRemoveConfig,
  mcpTutorialConfig,
  slackConnectConfig,
] as const satisfies readonly ProgramConfig[];

/**
 * Typed program names. Values come from each config's `id`, so there's
 * no parallel string list to keep in sync — adding `Program.Foo` here is
 * just exposing `fooConfig.id` under a friendly name for call sites.
 */
export const Program = {
  PostHogIntegration: posthogIntegrationConfig.id,
  RevenueAnalyticsSetup: revenueAnalyticsConfig.id,
  WarehouseSource: warehouseSourceConfig.id,
  ErrorTrackingUploadSourceMaps: errorTrackingUploadSourceMapsConfig.id,
  Migration: migrationConfig.id,
  Audit: auditConfig.id,
  EventsAudit: eventsAuditConfig.id,
  PosthogDoctor: posthogDoctorConfig.id,
  WebAnalyticsDoctor: webAnalyticsDoctorConfig.id,
  SelfDriving: selfDrivingConfig.id,
  AgentSkill: agentSkillConfig.id,
  McpAdd: mcpAddConfig.id,
  McpRemove: mcpRemoveConfig.id,
  McpTutorial: mcpTutorialConfig.id,
  SlackConnect: slackConnectConfig.id,
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

/** A program config that is exposed as a CLI subcommand. */
export type SubcommandProgram = ProgramConfig & { command: string };

/** All program configs that are exposed as CLI subcommands. */
export function getSubcommandPrograms(): SubcommandProgram[] {
  return PROGRAM_REGISTRY.filter(
    (c): c is SubcommandProgram => c.command != null,
  );
}
