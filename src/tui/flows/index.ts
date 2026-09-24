import { getProgramConfig, type ProgramId } from '@programs';
import type { FlowStep } from '../flow';
import { withAiOptInGate } from './ai-opt-in-gate';
import { AGENT_SKILL_FLOW } from './agent-skill';
import { AI_OBSERVABILITY_FLOW } from './ai-observability';
import { AUDIT_FLOW } from './audit';
import { ERROR_TRACKING_FLOW } from './error-tracking';
import { ERROR_TRACKING_UPLOAD_SOURCE_MAPS_FLOW } from './error-tracking-upload-source-maps';
import { EVENTS_AUDIT_FLOW } from './events-audit';
import { MCP_ADD_FLOW, MCP_REMOVE_FLOW, MCP_TUTORIAL_FLOW } from './mcp';
import { METRICS_FLOW } from './metrics';
import { MIGRATION_FLOW } from './migration';
import { POSTHOG_DOCTOR_FLOW } from './posthog-doctor';
import { POSTHOG_INTEGRATION_FLOW } from './posthog-integration';
import { REVENUE_ANALYTICS_FLOW } from './revenue-analytics';
import { SELF_DRIVING_FLOW } from './self-driving';
import { SLACK_CONNECT_FLOW } from './slack';
import { WAREHOUSE_SOURCE_FLOW } from './warehouse-source';
import { WEB_ANALYTICS_DOCTOR_FLOW } from './web-analytics-doctor';

/** Every registered program's flow, as its steps are declared. */
export const PROGRAM_FLOWS: Record<ProgramId, FlowStep[]> = {
  'posthog-integration': POSTHOG_INTEGRATION_FLOW,
  'revenue-analytics-setup': REVENUE_ANALYTICS_FLOW,
  'warehouse-source': WAREHOUSE_SOURCE_FLOW,
  'error-tracking-upload-source-maps': ERROR_TRACKING_UPLOAD_SOURCE_MAPS_FLOW,
  'error-tracking': ERROR_TRACKING_FLOW,
  audit: AUDIT_FLOW,
  'events-audit': EVENTS_AUDIT_FLOW,
  'posthog-doctor': POSTHOG_DOCTOR_FLOW,
  'web-analytics-doctor': WEB_ANALYTICS_DOCTOR_FLOW,
  migration: MIGRATION_FLOW,
  'self-driving': SELF_DRIVING_FLOW,
  'agent-skill': AGENT_SKILL_FLOW,
  'mcp-add': MCP_ADD_FLOW,
  'mcp-remove': MCP_REMOVE_FLOW,
  'mcp-tutorial': MCP_TUTORIAL_FLOW,
  'mcp-analytics': AGENT_SKILL_FLOW,
  'replay-vision': AGENT_SKILL_FLOW,
  'ai-observability': AI_OBSERVABILITY_FLOW,
  metrics: METRICS_FLOW,
  slack: SLACK_CONNECT_FLOW,
};

/** A program's flow as declared, without the AI opt-in gate. */
export function rawProgramFlow(programId: ProgramId): FlowStep[] {
  const flow = PROGRAM_FLOWS[programId];
  if (!flow) throw new Error(`No TUI flow for program "${programId}"`);
  return flow;
}

/** A program's flow with the AI opt-in gate injected after auth when the program requires AI. */
export function getProgramFlow(programId: ProgramId): FlowStep[] {
  return withAiOptInGate(
    getProgramConfig(programId),
    rawProgramFlow(programId),
  );
}
