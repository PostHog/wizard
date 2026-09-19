import type { SetupQuestion } from '../framework-config.js';
import type { ProgramId } from '../programs/program-registry.js';
import type { WizardSession } from '../session/wizard-session.js';
import type { PlannedEvent, TaskItem, WizardStore } from '../state/store.js';
import type { CONTROL_SESSION_KEYS } from './state.js';

/** One commit a controlling parent may make on a screen. */
export interface DriverAction {
  /** Stable id named in `POST /actions/<id>`. */
  id: string;
  description: string;
  /** Parameter name to a human/type hint. Absent means no params. */
  params?: Record<string, string>;
  /** Apply the commit through exactly one store setter or resolver. */
  apply: (store: WizardStore, params: Record<string, unknown>) => void;
}

/** The session as a parent reads it: the listed fields, credentials as a flag. */
export type ControlSession = Pick<
  WizardSession,
  (typeof CONTROL_SESSION_KEYS)[number]
> & {
  hasCredentials: boolean;
  projectId: number | null;
};

/**
 * The store as a parent reads it: the committed session whitelist, the run
 * atoms, and what the flow derives for the current screen. No access token,
 * API key, user record, or answer value is ever projected.
 */
export interface ControlState {
  version: number;
  currentScreen: string;
  session: ControlSession;
  tasks: TaskItem[];
  statusMessages: string[];
  eventPlan: PlannedEvent[];
  handoffText: string | null;
  /** Setup questions the session has not answered yet. */
  setupQuestions: Array<Omit<SetupQuestion, 'detect'>>;
  /** The commits legal on `currentScreen`. */
  actions: Array<Omit<DriverAction, 'apply'>>;
}

export type DetectRequest = { programId?: ProgramId } & Partial<
  Pick<WizardSession, 'installDir'>
>;

export type RunRequest = { programId: ProgramId } & Partial<
  Pick<WizardSession, 'installDir' | 'frameworkContext' | 'skillId'>
>;

/** One independent run the headless surface served. */
export interface RunRecord {
  runId: string;
  programId: ProgramId;
  installDir: string;
  status: 'running' | 'done' | 'failed';
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** The state as `GET /state` read it when the run ended. */
  result: ControlState | null;
}

export type ControlSurface = 'tui' | 'headless';

/** What the composition root does on the parent's behalf; the store never runs agents. */
export interface ControlHooks {
  /** Resolve credentials host side and commit them, advancing `auth`. */
  setCredentials(): Promise<void>;
  /** Headless surface: run detection for a program, writing through setters. */
  detect(req: DetectRequest): Promise<void>;
  /** Headless surface: one independent agent run. Resolves when it ends. */
  startRun(req: RunRequest): Promise<void>;
  /** Flush and exit. Idempotent. */
  shutdown(): Promise<void>;
}
