import { AgentErrorType } from '../agent/signals';
import { ErrorCodes, type ErrorCode } from './codes';

export const AGENT_ERROR_CODE: Record<AgentErrorType, ErrorCode> = {
  [AgentErrorType.MCP_MISSING]: ErrorCodes.AgentMcpMissing,
  [AgentErrorType.RESOURCE_MISSING]: ErrorCodes.AgentResourceMissing,
  [AgentErrorType.RATE_LIMIT]: ErrorCodes.AgentRateLimit,
  [AgentErrorType.API_ERROR]: ErrorCodes.AgentApiError,
  [AgentErrorType.MODULE_MISSING]: ErrorCodes.AgentModuleMissing,
  [AgentErrorType.YARA_VIOLATION]: ErrorCodes.AgentYaraViolation,
  [AgentErrorType.ABORT]: ErrorCodes.AgentAbort,
  [AgentErrorType.NO_PROGRESS]: ErrorCodes.AgentNoProgress,
  [AgentErrorType.INCOMPLETE_TASKS]: ErrorCodes.AgentIncompleteTasks,
};
