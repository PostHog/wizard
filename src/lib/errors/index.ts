export {
  ErrorCodes,
  ERROR_CODE_PATTERN,
  isErrorCode,
  type ErrorCode,
} from './codes';
export { ERROR_CATALOG } from './catalog';
export type { ErrorCatalogEntry, ErrorGroup, RetryAdvice } from './types';
export { classifyAuthFailure, type AuthFailureInput } from './auth';
export { AGENT_ERROR_CODE } from './agent-map';
export { detectErrorCode } from './detect-map';
export { skillErrorCode } from './skill-map';
export {
  PHW_ERROR_PREFIX,
  emitPhwError,
  formatPhwErrorLine,
  type PhwErrorLine,
} from './emit';
