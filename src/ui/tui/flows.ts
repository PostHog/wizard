/**
 * Flow pipelines — declarative screen sequences for each wizard flow.
 *
 * Owns the Screen and Flow enums (re-exported by router.ts) to avoid
 * circular imports between router ↔ flows.
 *
 * Workflow-based flows are derived from WORKFLOW_REGISTRY via
 * workflowToFlowEntries(). MCP add/remove flows are standalone since
 * they don't go through the agent runner.
 */

import type { WizardSession } from '../../lib/wizard-session.js';
import {
  workflowToFlowEntries,
  type Workflow,
} from '../../lib/workflows/workflow-step.js';
import { WORKFLOW_REGISTRY } from '../../lib/workflows/workflow-registry.js';
import { AGENT_SKILL_STEPS } from '../../lib/workflows/agent-skill/index.js';

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
  CoreIntegration = 'core-integration',
  RevenueAnalytics = 'revenue-analytics',
  AgentSkill = 'agent-skill',
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

// ── Derived from WORKFLOW_REGISTRY ───────────────────────────────────

/** Raw workflow step arrays — used by the store for gate/onInit definitions. */
export const WORKFLOW_STEPS: Partial<Record<Flow, Workflow>> = {
  ...(Object.fromEntries(
    WORKFLOW_REGISTRY.map((c) => [c.flowKey, c.steps]),
  ) as Partial<Record<Flow, Workflow>>),
  [Flow.AgentSkill]: AGENT_SKILL_STEPS,
};

/**
 * All flow pipelines.
 *
 * Workflow-based flows are derived from the registry.
 * MCP add/remove flows are standalone.
 */
export const FLOWS: Record<Flow, FlowEntry[]> = {
  // Derive workflow flows from registry
  ...(Object.fromEntries(
    WORKFLOW_REGISTRY.map((c) => [
      c.flowKey,
      workflowToFlowEntries(c.steps) as FlowEntry[],
    ]),
  ) as Record<Flow, FlowEntry[]>),

  // Generic agent skill flow
  [Flow.AgentSkill]: workflowToFlowEntries(AGENT_SKILL_STEPS) as FlowEntry[],

  // Standalone MCP flows
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
