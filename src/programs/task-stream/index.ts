/**
 * Task-stream — push wizard run state to external consumers.
 */

export { TaskStreamPush } from '../session/task-stream/task-stream-push';
export type { TaskStreamPushOptions } from '../session/task-stream/task-stream-push';

export { PostHogDestination } from '../session/task-stream/destinations/posthog';
export {
  FileDestination,
  createFileDestination,
} from '../session/task-stream/destinations/file';

export {
  rollUpAuditAreas,
  MAX_AUDIT_AREAS,
} from '../session/task-stream/audit-areas';

export { StreamTaskStatus, StreamEvent } from '../session/task-stream/types';
export type {
  TaskStreamUpdate,
  TaskStreamDestination,
  StreamTask,
  TaskStreamError,
} from '../session/task-stream/types';
