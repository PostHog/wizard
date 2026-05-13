/**
 * Central registry of all wizard workflows.
 *
 * Adding a new workflow:
 *   1. Create src/lib/workflows/<name>/ with index.ts exporting a WorkflowConfig
 *   2. Import and add it to WORKFLOW_REGISTRY below
 *   3. Add a matching Flow enum entry in src/ui/tui/flows.ts
 *   4. (If custom intro screen) add to src/ui/tui/screen-registry.tsx
 *
 * flows.ts, store.ts, and bin.ts all derive their wiring from this array —
 * no need to touch those files when adding a workflow.
 */

import type { WorkflowConfig } from './workflow-step.js';
import { posthogIntegrationConfig } from './posthog-integration/index.js';
import { revenueAnalyticsConfig } from './revenue-analytics/index.js';
import { conciergeConfig } from './concierge/index.js';

export const WORKFLOW_REGISTRY: WorkflowConfig[] = [
  posthogIntegrationConfig,
  revenueAnalyticsConfig,
  conciergeConfig,
];

/** Look up a workflow config by its flowKey. */
export function getWorkflowConfig(flowKey: string): WorkflowConfig | undefined {
  return WORKFLOW_REGISTRY.find((c) => c.flowKey === flowKey);
}

/** All workflow configs that are exposed as CLI subcommands. */
export function getSubcommandWorkflows(): WorkflowConfig[] {
  return WORKFLOW_REGISTRY.filter((c) => c.command != null);
}
