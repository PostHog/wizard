/**
 * Flow pipelines — declarative screen sequences for each wizard flow.
 *
 * Owns the Screen and Flow enums (re-exported by router.ts) to avoid
 * circular imports between router ↔ flows.
 *
 * Each flow is derived from a Workflow definition via workflowToFlowEntries().
 * MCP add/remove flows are standalone since they don't go through the agent runner.
 */

import type { WizardSession } from '../../lib/wizard-session.js';
import {
  workflowToFlowEntries,
  type Workflow,
} from '../../lib/workflow-step.js';
import { POSTHOG_INTEGRATION_WORKFLOW } from '../../lib/workflows/posthog-integration.js';
import { REVENUE_ANALYTICS_WORKFLOW } from '../../lib/workflows/revenue-analytics.js';

// ── Screen + Flow enums ──────────────────────────────────────────────

/** Screens that participate in linear flows */
export enum Screen {
  Intro = 'intro',
  RevenueIntro = 'revenue-intro',
  HealthCheck = 'health-check',
  Setup = 'setup',
  Auth = 'auth',
  Run = 'run',
  Mcp = 'mcp',
  Skills = 'skills',
  Outro = 'outro',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
}

/** Named flows the router can run */
export enum Flow {
  Wizard = 'wizard',
  Revenue = 'revenue',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
}

// ── Flow definitions ─────────────────────────────────────────────────

export interface FlowEntry {
  /** Screen to show */
  screen: Screen;
  /** If provided, screen is skipped when this returns false. Omit = always show. */
  show?: (session: WizardSession) => boolean;
  /** If provided, screen is considered complete when this returns true. */
  isComplete?: (session: WizardSession) => boolean;
}

/** Raw workflow step arrays — used by the store for gate/onInit definitions. */
export const WORKFLOW_STEPS: Partial<Record<Flow, Workflow>> = {
  [Flow.Wizard]: POSTHOG_INTEGRATION_WORKFLOW,
  [Flow.Revenue]: REVENUE_ANALYTICS_WORKFLOW,
};

/**
 * All flow pipelines.
 *
 * Integration and Revenue flows are derived from their workflow definitions.
 * MCP add/remove flows are standalone.
 */
export const FLOWS: Record<Flow, FlowEntry[]> = {
  [Flow.Wizard]: workflowToFlowEntries(
    POSTHOG_INTEGRATION_WORKFLOW,
  ) as FlowEntry[],

  [Flow.Revenue]: workflowToFlowEntries(
    REVENUE_ANALYTICS_WORKFLOW,
  ) as FlowEntry[],

  [Flow.McpAdd]: [
    {
      screen: Screen.McpAdd,
      isComplete: (s) => s.mcpComplete,
    },
    { screen: Screen.Outro },
  ],

  [Flow.McpRemove]: [
    {
      screen: Screen.McpRemove,
      isComplete: (s) => s.mcpComplete,
    },
    { screen: Screen.Outro },
  ],
};
