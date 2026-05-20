/**
 * Task-stream types — wire schema for pushing wizard run state
 * to external consumers (PostHog web app, etc.).
 *
 * The schema is intentionally generic: onboarding is the first consumer,
 * but migrations, audits, and single-task installs can reuse the same
 * transport with a different workflow_id / skill_id pair.
 *
 * Naming note: the backend's public DTO field is `workflow_id` (URL
 * query, regex validation, SSE channel name). The wizard CLI uses
 * "program" terminology internally, so the field is named programId
 * on TaskStreamPush but serialised to `workflow_id` here.
 */

import type { RunPhase } from '@lib/wizard-session';

export enum StreamTaskStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export enum StreamEvent {
  Create = 'CREATE',
  Update = 'UPDATE',
  Complete = 'COMPLETE',
  Error = 'ERROR',
}

export interface StreamTask {
  id: string;
  title: string;
  status: StreamTaskStatus;
}

export interface TaskStreamError {
  type: string;
  message: string;
}

/**
 * Wire payload the wizard pushes on every state change.
 *
 * Every run is a new session_id. The wizard never updates an old session —
 * re-running the same program + skill is a new row with a newer timestamp.
 * Consumers get the current view by picking the latest session for a given
 * (workflow_id, skill_id) pair.
 */
export interface TaskStreamUpdate {
  session_id: string;
  workflow_id: string;
  skill_id: string;
  started_at: string;
  run_phase: RunPhase;
  tasks: StreamTask[];
  event_plan?: unknown;
  error?: TaskStreamError;
  /** UTC ISO 8601 timestamp of this payload. Latest update wins on conflict. */
  timestamp: string;
}

/**
 * A destination receives task-stream lifecycle events.
 * Implementations must be fire-and-forget — never throw.
 */
export interface TaskStreamDestination {
  readonly name: string;
  send(event: StreamEvent, payload: TaskStreamUpdate): Promise<void>;
}
