import type {
  TaskStreamDestination,
  TaskStreamUpdate,
  StreamEvent,
} from '../types';

export class PostHogDestination implements TaskStreamDestination {
  readonly name = 'posthog';

  send(_event: StreamEvent, _payload: TaskStreamUpdate): Promise<void> {
    // TODO: implement when the PostHog API surface is defined.
    return Promise.resolve();
  }
}
