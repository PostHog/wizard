/**
 * Central registry of all wizard programs.
 *
 * Adding a new program:
 *   1. Create src/lib/programs/<name>/ with index.ts exporting a ProgramConfig
 *   2. Import and add it to PROGRAM_REGISTRY below
 *   3. Add a matching Program enum entry in src/ui/tui/programs.ts
 *   4. (If custom intro screen) add to src/ui/tui/screen-registry.tsx
 *
 * programs.ts, store.ts, and bin.ts all derive their wiring from this array —
 * no need to touch those files when adding a program.
 */

import type { ProgramConfig } from './program-step.js';
import { posthogIntegrationConfig } from './posthog-integration/index.js';
import { revenueAnalyticsConfig } from './revenue-analytics/index.js';
import { auditConfig } from './audit/index.js';
import { eventsAuditConfig } from './events-audit/index.js';
import { audit3000Config } from './audit-3000/index.js';
import { posthogDoctorConfig } from './posthog-doctor/index.js';
import { migrationConfig } from './migration/index.js';

export const PROGRAM_REGISTRY: ProgramConfig[] = [
  posthogIntegrationConfig,
  revenueAnalyticsConfig,
  auditConfig,
  eventsAuditConfig,
  audit3000Config,
  posthogDoctorConfig,
  migrationConfig,
];

/** Look up a program config by its id. */
export function getProgramConfig(id: string): ProgramConfig | undefined {
  return PROGRAM_REGISTRY.find((c) => c.id === id);
}

/** All program configs that are exposed as CLI subcommands. */
export function getSubcommandPrograms(): ProgramConfig[] {
  return PROGRAM_REGISTRY.filter((c) => c.command != null);
}
