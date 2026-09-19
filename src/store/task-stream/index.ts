/**
 * Task-stream — push wizard run state to external consumers.
 */

export { TaskStreamPush } from './task-stream-push.js';
export type { TaskStreamPushOptions } from './task-stream-push.js';

export { PostHogDestination } from './destinations/posthog.js';
export { FileDestination, createFileDestination } from './destinations/file.js';

export { rollUpAuditAreas, MAX_AUDIT_AREAS } from './audit-areas.js';

export { StreamTaskStatus, StreamEvent } from './types.js';
export type {
  TaskStreamUpdate,
  TaskStreamDestination,
  StreamTask,
  TaskStreamError,
} from './types.js';
