// Leaf module on purpose: every module imports the errors, so the agent entry
// would form a module cycle here.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- B1: error codes move next to their owners
import { AgentErrorType } from '@agent/signals';
import { ErrorCodes, type ErrorCode } from './codes';

export const AGENT_ERROR_CODE: Record<AgentErrorType, ErrorCode> = {
  [AgentErrorType.AGENTIC_DETECTION_TIMEOUT]:
    ErrorCodes.AgenticDetectionTimeout,
  [AgentErrorType.MCP_MISSING]: ErrorCodes.AgentMcpMissing,
  [AgentErrorType.RESOURCE_MISSING]: ErrorCodes.AgentResourceMissing,
  [AgentErrorType.RATE_LIMIT]: ErrorCodes.AgentRateLimit,
  [AgentErrorType.API_ERROR]: ErrorCodes.AgentApiError,
  [AgentErrorType.YARA_VIOLATION]: ErrorCodes.AgentYaraViolation,
  [AgentErrorType.ABORT]: ErrorCodes.AgentAbort,
  [AgentErrorType.NO_PROGRESS]: ErrorCodes.AgentNoProgress,
  [AgentErrorType.INCOMPLETE_TASKS]: ErrorCodes.AgentIncompleteTasks,
};
