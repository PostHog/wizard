import { appendFileSync } from 'node:fs';
import type {
  TaskStreamDestination,
  TaskStreamUpdate,
  StreamEvent,
} from '../types';
import { WIZARD_TASK_STREAM_LOG } from '../../../utils/paths';

export class FileDestination implements TaskStreamDestination {
  readonly name = 'file';

  send(event: StreamEvent, payload: TaskStreamUpdate): Promise<void> {
    try {
      appendFileSync(
        WIZARD_TASK_STREAM_LOG,
        `[${event}] ${JSON.stringify(payload, null, 2)}\n`,
      );
    } catch {
      // Non-critical
    }
    return Promise.resolve();
  }
}
