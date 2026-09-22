import type { AgentRunDefinition } from '@agent/types';
import { skillRunDefinition } from './agent-skill/run-definition.js';
import { AI_OBSERVABILITY_RUN } from './ai-observability/run.js';
import { MCP_ANALYTICS_OPTIONS } from './mcp-analytics/run.js';
import { METRICS_RUN } from './metrics/run.js';
import { MIGRATION_RUN } from './migration/run.js';
import { REPLAY_VISION_OPTIONS } from './replay-vision/run.js';
import { REVENUE_ANALYTICS_RUN } from './revenue-analytics/run.js';
import { WEB_ANALYTICS_DOCTOR_OPTIONS } from './web-analytics-doctor/run.js';

export type RuntimeProgramConfig = {
  id: string;
  agentFlow?: string;
  requiresAi?: boolean;
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
  run?: AgentRunDefinition;
};

const WIZARD_ASK = 'mcp__wizard-tools__wizard_ask';
const AUDIT_TOOLS = [
  'Agent',
  'mcp__wizard-tools__audit_seed_checks',
  'mcp__wizard-tools__audit_add_checks',
  'mcp__wizard-tools__audit_resolve_checks',
];

export const RUNTIME_PROGRAM_REGISTRY = [
  {
    id: 'posthog-integration',
    agentFlow: 'integration-v2',
    disallowedTools: [WIZARD_ASK],
  },
  {
    id: 'revenue-analytics-setup',
    allowedTools: ['Agent'],
    disallowedTools: [WIZARD_ASK],
    run: REVENUE_ANALYTICS_RUN,
  },
  { id: 'warehouse-source', allowedTools: ['Agent'] },
  { id: 'error-tracking-upload-source-maps', requiresAi: true },
  { id: 'error-tracking', agentFlow: 'error-tracking' },
  {
    id: 'audit',
    allowedTools: AUDIT_TOOLS,
    disallowedTools: [WIZARD_ASK],
  },
  {
    id: 'events-audit',
    allowedTools: AUDIT_TOOLS,
    disallowedTools: [WIZARD_ASK],
  },
  {
    id: 'posthog-doctor',
    requiresAi: false,
    allowedTools: ['Agent'],
    disallowedTools: [WIZARD_ASK],
  },
  {
    id: 'web-analytics-doctor',
    run: skillRunDefinition(WEB_ANALYTICS_DOCTOR_OPTIONS),
  },
  {
    id: 'migration',
    allowedTools: ['Agent'],
    disallowedTools: [WIZARD_ASK],
    run: MIGRATION_RUN,
  },
  { id: 'self-driving' },
  { id: 'agent-skill', allowedTools: ['Agent'] },
  { id: 'mcp-add', requiresAi: false },
  { id: 'mcp-remove', requiresAi: false },
  { id: 'mcp-tutorial', requiresAi: false },
  { id: 'mcp-analytics', run: skillRunDefinition(MCP_ANALYTICS_OPTIONS) },
  {
    id: 'replay-vision',
    agentFlow: 'replay-vision',
    run: skillRunDefinition(REPLAY_VISION_OPTIONS),
  },
  { id: 'ai-observability', run: AI_OBSERVABILITY_RUN },
  { id: 'metrics', agentFlow: 'metrics', run: METRICS_RUN },
  { id: 'slack' },
] as const satisfies readonly RuntimeProgramConfig[];

export type RuntimeProgramId = (typeof RUNTIME_PROGRAM_REGISTRY)[number]['id'];

export function getRuntimeProgramConfig(
  id: string,
): RuntimeProgramConfig | undefined {
  return RUNTIME_PROGRAM_REGISTRY.find((config) => config.id === id);
}
