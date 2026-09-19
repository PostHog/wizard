export {
  ErrorCodes,
  ERROR_CODE_PATTERN,
  isErrorCode,
  type ErrorCode,
} from './codes.js';
export { ERROR_CATALOG } from './catalog.js';
export type { ErrorCatalogEntry, ErrorGroup, RetryAdvice } from './types.js';
export { classifyAuthFailure, type AuthFailureInput } from './auth.js';
export { AGENT_ERROR_CODE } from './agent-map.js';
export { detectErrorCode, type DetectErrorKind } from './detect-map.js';
export { skillErrorCode } from './skill-map.js';
export {
  PHW_ERROR_PREFIX,
  emitWizardError,
  formatWizardErrorLine,
  type WizardErrorLine,
} from './emit.js';
export { sanitizeErrorDetail } from './sanitize.js';
export { classifyRunFailure, type RunFailure } from './run-failure.js';
