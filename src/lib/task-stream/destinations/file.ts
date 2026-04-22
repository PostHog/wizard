import { appendFileSync } from 'node:fs';
import type {
  TaskStreamDestination,
  TaskStreamUpdate,
  StreamEvent,
} from '../types';

const TASK_STREAM_LOG = '/tmp/posthog-task-stream.log';

export class FileDestination implements TaskStreamDestination {
  readonly name = 'file';

  send(event: StreamEvent, payload: TaskStreamUpdate): Promise<void> {
    try {
      appendFileSync(
        TASK_STREAM_LOG,
        `[${event}] ${JSON.stringify(payload)}\n`,
      );
    } catch {
      // Non-critical
    }
    return Promise.resolve();
  }
}
