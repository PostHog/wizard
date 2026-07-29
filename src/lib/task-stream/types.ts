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
export interface StreamEventPlan {
  events: Array<{ name: string; description?: string }>;
}

/**
 * An in-flight `wizard_ask` request, published so the web app can tell
 * the user their terminal is waiting on them. Null/absent means no input
 * is pending — consumers treat the next push without this field as the
 * dismissal signal.
 */
export interface StreamPendingInput {
  /** PendingQuestion id — stable for the lifetime of one ask. */
  id: string;
  /** UTC ISO 8601 timestamp of when the overlay opened. */
  asked_at: string;
  question_count: number;
  /** True when any question is marked sensitive (secrets, API keys). */
  sensitive: boolean;
  /**
   * Prompt texts, omitted entirely when `sensitive` is true so secret
   * prompts never reach the team-visible session row.
   */
  prompts?: string[];
}

export interface TaskStreamUpdate {
  session_id: string;
  workflow_id: string;
  skill_id: string;
  started_at: string;
  run_phase: RunPhase;
  tasks: StreamTask[];
  event_plan?: StreamEventPlan;
  error?: TaskStreamError;
  pending_input?: StreamPendingInput;
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
