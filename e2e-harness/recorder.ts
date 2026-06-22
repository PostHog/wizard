/**
 * WizardRecorder — records a wizard run as a timeline of frames, one per "key
 * moment", so the run can be replayed in the terminal later (by an agent or a
 * human) to verify what happened.
 *
 * Key moments are store/router changes: a route (screen) change, a runPhase
 * change, a task-list update, a new status line, an event-plan update, or an
 * overlay push/pop. The recorder subscribes to the store's single version
 * counter (the same signal React uses) and snapshots state whenever one of
 * those changes — so the recording mirrors exactly what the live TUI would have
 * repainted on.
 *
 * Each frame stores the (secret-redacted) session plus tasks/status/event-plan,
 * which is enough for {@link ../replay} to reconstruct a throwaway store and
 * render the real Ink screen back to ANSI.
 */

import type { WizardStore } from '@ui/tui/store';
import type { ScreenName } from '@ui/tui/router';
import type { WizardSession } from '@lib/wizard-session';

/** The change(s) that triggered a frame. */
export type FrameTrigger =
  | 'start'
  | 'screen'
  | 'runPhase'
  | 'tasks'
  | 'status'
  | 'eventPlan'
  | 'overlay';

export interface RecordedFrame {
  seq: number;
  /** ms since the recording started. */
  ms: number;
  /** Which key moment(s) produced this frame. */
  triggers: FrameTrigger[];
  screen: ScreenName;
  hasOverlay: boolean;
  /** Session snapshot with the access token redacted. */
  session: WizardSession;
  tasks: Array<{
    label: string;
    status: string;
    activeForm?: string;
    done: boolean;
  }>;
  statusMessages: string[];
  eventPlan: Array<{ name: string; description: string }>;
}

export interface Recording {
  meta: { program: string; app?: string; startedAtMs: number };
  frames: RecordedFrame[];
}

/** Redact the access token — recordings are shareable artifacts. */
function redactSession(session: WizardSession): WizardSession {
  if (!session.credentials) return session;
  return {
    ...session,
    credentials: { ...session.credentials, accessToken: 'phx_***redacted***' },
  };
}

export class WizardRecorder {
  private frames: RecordedFrame[] = [];
  private seq = 0;
  private startMs: number;
  private unsub: (() => void) | null = null;

  private prevScreen: ScreenName;
  private prevRunPhase: WizardSession['runPhase'];
  private prevTasks: unknown;
  private prevStatus: unknown;
  private prevEventPlan: unknown;
  private prevOverlay: boolean;

  constructor(
    private readonly store: WizardStore,
    private readonly meta: { program: string; app?: string },
    private readonly now: () => number = () => Date.now(),
  ) {
    this.startMs = this.now();
    this.prevScreen = store.currentScreen;
    this.prevRunPhase = store.session.runPhase;
    this.prevTasks = store.tasks;
    this.prevStatus = store.statusMessages;
    this.prevEventPlan = store.eventPlan;
    this.prevOverlay = store.router.hasOverlay;
  }

  /** Begin recording: snapshot the initial frame and subscribe to changes. */
  start(): void {
    this.capture(['start']);
    this.unsub = this.store.subscribe(() => this.onChange());
  }

  /** Stop recording. */
  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  private onChange(): void {
    const s = this.store;
    const triggers: FrameTrigger[] = [];
    // The store replaces these by reference on every mutation, so identity
    // comparison detects each kind of key moment.
    if (s.currentScreen !== this.prevScreen) triggers.push('screen');
    if (s.session.runPhase !== this.prevRunPhase) triggers.push('runPhase');
    if (s.tasks !== this.prevTasks) triggers.push('tasks');
    if (s.statusMessages !== this.prevStatus) triggers.push('status');
    if (s.eventPlan !== this.prevEventPlan) triggers.push('eventPlan');
    if (s.router.hasOverlay !== this.prevOverlay) triggers.push('overlay');

    this.prevScreen = s.currentScreen;
    this.prevRunPhase = s.session.runPhase;
    this.prevTasks = s.tasks;
    this.prevStatus = s.statusMessages;
    this.prevEventPlan = s.eventPlan;
    this.prevOverlay = s.router.hasOverlay;

    if (triggers.length > 0) this.capture(triggers);
  }

  private capture(triggers: FrameTrigger[]): void {
    this.frames.push({
      seq: this.seq++,
      ms: this.now() - this.startMs,
      triggers,
      screen: this.store.currentScreen,
      hasOverlay: this.store.router.hasOverlay,
      session: redactSession(this.store.session),
      tasks: this.store.tasks.map((t) => ({
        label: t.label,
        status: t.status,
        activeForm: t.activeForm,
        done: t.done,
      })),
      statusMessages: [...this.store.statusMessages],
      eventPlan: this.store.eventPlan.map((e) => ({
        name: e.name,
        description: e.description,
      })),
    });
  }

  getRecording(): Recording {
    return {
      meta: { ...this.meta, startedAtMs: this.startMs },
      frames: this.frames,
    };
  }

  get frameCount(): number {
    return this.frames.length;
  }
}
