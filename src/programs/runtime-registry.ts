import { WIZARD_TOOL_NAMES } from '@agent';
import type { AgentRunDefinition } from '@agent/types';
import { EVENT_PLAN_FILE } from '@shared/constants';
import { AUDIT_CHECKS_FILE, type AuditCheck } from '@shared/audit-ledger';
import { skillRunDefinition } from './agent-skill/run-definition.js';
import { AUDIT_SEED_CHECKS } from './audit/seed.js';
import { EVENTS_AUDIT_SEED_CHECKS } from './events-audit/seed.js';
import { AI_OBSERVABILITY_RUN } from './ai-observability/run.js';
import { MCP_ANALYTICS_OPTIONS } from './mcp-analytics/run.js';
import { METRICS_RUN } from './metrics/run.js';
import { MIGRATION_RUN } from './migration/run.js';
import { REPLAY_VISION_OPTIONS } from './replay-vision/run.js';
import { REVENUE_ANALYTICS_RUN } from './revenue-analytics/run.js';
import { WEB_ANALYTICS_DOCTOR_OPTIONS } from './web-analytics-doctor/run.js';
import { excludedIntegrationTaskTypes } from './posthog-integration/run.js';
import {
  resolveAgentSkillRunDefinition,
  resolveAuditRunDefinition,
  resolveErrorTrackingRunDefinition,
  resolveEventsAuditRunDefinition,
  resolveSourceMapsRunDefinition,
  resolveWarehouseSourceRunDefinition,
  type ProgramRunDefinitionInput,
} from './resolve-run-definition.js';

type RuntimeProgramConfigBase = {
  id: string;
  agentFlow?: string;
  requiresAi?: boolean;
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
  /** Task types the orchestrator drops for this run's wizard flags. */
  excludedTaskTypes?: (flags: Record<string, string>) => readonly string[];
  auditLedgerFile?: string;
  auditSeedChecks?: readonly AuditCheck[];
  eventPlanFile?: string;
  /** False for programs without the health-check step, so preflight skips readiness. */
  healthCheck?: boolean;
  /** Steps a host settles after auth and before the run, asked as one post-auth request. */
  postAuthGates?: readonly string[];
  /** Child program runs a composed program starts before its own agent. */
  composedRuns?: readonly { stepId: string; runProgramId: string }[];
};

export type RuntimeProgramConfig = RuntimeProgramConfigBase &
  (
    | { strategy: 'static'; run: AgentRunDefinition }
    | {
        strategy: 'resolved';
        resolve: (
          input: ProgramRunDefinitionInput,
        ) => AgentRunDefinition | undefined;
        run?: never;
      }
    | {
        strategy: 'integration' | 'self-driving' | 'no-agent';
        run?: never;
        resolve?: never;
      }
  );

const WIZARD_ASK = WIZARD_TOOL_NAMES.wizardAsk;
const AUDIT_TOOLS = [
  'Agent',
  WIZARD_TOOL_NAMES.auditSeedChecks,
  WIZARD_TOOL_NAMES.auditAddChecks,
  WIZARD_TOOL_NAMES.auditResolveChecks,
];
const MCP_CLIENT_PROGRAM = {
  strategy: 'no-agent',
  requiresAi: false,
  healthCheck: false,
} as const;

export const RUNTIME_PROGRAM_REGISTRY = [
  {
    id: 'posthog-integration',
    strategy: 'integration',
    agentFlow: 'integration-v2',
    disallowedTools: [WIZARD_ASK],
    excludedTaskTypes: excludedIntegrationTaskTypes,
    eventPlanFile: EVENT_PLAN_FILE,
  },
  {
    id: 'revenue-analytics-setup',
    strategy: 'static',
    allowedTools: ['Agent'],
    disallowedTools: [WIZARD_ASK],
    run: REVENUE_ANALYTICS_RUN,
  },
  {
    id: 'warehouse-source',
    strategy: 'resolved',
    resolve: (input) =>
      resolveWarehouseSourceRunDefinition(input.warehouseSources ?? []),
    allowedTools: ['Agent'],
    healthCheck: false,
  },
  {
    id: 'error-tracking-upload-source-maps',
    strategy: 'resolved',
    resolve: (input) =>
      resolveSourceMapsRunDefinition(input.sourceMapsSelection),
    requiresAi: true,
    postAuthGates: ['detect'],
    healthCheck: false,
  },
  {
    id: 'error-tracking',
    strategy: 'resolved',
    resolve: resolveErrorTrackingRunDefinition,
    agentFlow: 'error-tracking',
  },
  {
    id: 'audit',
    strategy: 'resolved',
    resolve: resolveAuditRunDefinition,
    allowedTools: AUDIT_TOOLS,
    disallowedTools: [WIZARD_ASK],
    auditLedgerFile: AUDIT_CHECKS_FILE,
    auditSeedChecks: AUDIT_SEED_CHECKS,
  },
  {
    id: 'events-audit',
    strategy: 'resolved',
    resolve: resolveEventsAuditRunDefinition,
    allowedTools: AUDIT_TOOLS,
    disallowedTools: [WIZARD_ASK],
    auditLedgerFile: AUDIT_CHECKS_FILE,
    auditSeedChecks: EVENTS_AUDIT_SEED_CHECKS,
  },
  {
    id: 'posthog-doctor',
    strategy: 'no-agent',
    requiresAi: false,
    allowedTools: ['Agent'],
    disallowedTools: [WIZARD_ASK],
  },
  {
    id: 'web-analytics-doctor',
    strategy: 'static',
    run: skillRunDefinition(WEB_ANALYTICS_DOCTOR_OPTIONS),
  },
  {
    id: 'migration',
    strategy: 'static',
    allowedTools: ['Agent'],
    disallowedTools: [WIZARD_ASK],
    run: MIGRATION_RUN,
  },
  {
    id: 'self-driving',
    strategy: 'self-driving',
    composedRuns: [
      { stepId: 'integrate-run', runProgramId: 'posthog-integration' },
    ],
  },
  {
    id: 'agent-skill',
    strategy: 'resolved',
    resolve: ({ skillId }) =>
      skillId ? resolveAgentSkillRunDefinition(skillId) : undefined,
    allowedTools: ['Agent'],
  },
  { id: 'mcp-add', ...MCP_CLIENT_PROGRAM },
  { id: 'mcp-remove', ...MCP_CLIENT_PROGRAM },
  { id: 'mcp-tutorial', ...MCP_CLIENT_PROGRAM },
  {
    id: 'mcp-analytics',
    strategy: 'static',
    run: skillRunDefinition(MCP_ANALYTICS_OPTIONS),
  },
  {
    id: 'replay-vision',
    strategy: 'static',
    agentFlow: 'replay-vision',
    run: skillRunDefinition(REPLAY_VISION_OPTIONS),
  },
  { id: 'ai-observability', strategy: 'static', run: AI_OBSERVABILITY_RUN },
  { id: 'metrics', strategy: 'static', agentFlow: 'metrics', run: METRICS_RUN },
  { id: 'slack', strategy: 'no-agent', healthCheck: false },
] as const satisfies readonly RuntimeProgramConfig[];

export function getRuntimeProgramConfig(
  id: string,
): RuntimeProgramConfig | undefined {
  return RUNTIME_PROGRAM_REGISTRY.find((config) => config.id === id);
}
