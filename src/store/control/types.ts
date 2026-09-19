import type {
  OutroKind,
  PendingQuestion,
  RunPhase,
} from '../session/wizard-session.js';
import type { ErrorCode } from '../shared/errors/codes.js';
import type { WizardStore } from '../state/store.js';

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

/** An action as a caller sees it: no closure. */
export interface ActionView {
  id: string;
  description: string;
  params?: Record<string, string>;
}

export interface SetupQuestionView {
  key: string;
  message: string;
  options: Array<{ label: string; value: string; hint?: string }>;
}

export interface TaskNoticeView {
  title: string;
  items: string[];
  prompt: string;
}

export type RunStatus = 'idle' | 'running' | 'done' | 'failed';

/** The outro reduced to what a parent needs; never the rendered body. */
export interface OutroView {
  kind: OutroKind;
  errorCode?: ErrorCode;
  message?: string;
  docsUrl?: string;
}

export interface RunResult {
  runPhase: RunPhase;
  outroData: OutroView | null;
  dashboardUrl: string | null;
  notebookUrl: string | null;
  handoffText: string | null;
}

export interface RunRecord {
  runId: string;
  programId: string;
  installDir: string;
  status: Exclude<RunStatus, 'idle'>;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  result: RunResult | null;
}

/**
 * The observable state. A whitelist of the session: credentials reduce to a
 * boolean and framework context passes a redaction, so no secret reaches a
 * controlling parent.
 */
export interface ControlState {
  version: number;
  currentScreen: string;
  hasOverlay: boolean;
  runPhase: RunPhase;
  run: { status: RunStatus; error: string | null };
  session: {
    installDir: string;
    integration: string | null;
    detectedFrameworkLabel: string | null;
    detectionComplete: boolean;
    setupConfirmed: boolean;
    integrate: boolean | null;
    hasCredentials: boolean;
    projectId: number | null;
    mcpComplete: boolean;
    slackStepDismissed: boolean;
    skillsComplete: boolean;
    outroDismissed: boolean;
    llmOptIn: boolean;
    discoveredFeatures: string[];
    runRequested: boolean;
    completedRuns: string[];
  };
  tasks: Array<{ label: string; status: string; activeForm?: string }>;
  statusMessages: string[];
  eventPlan: Array<{ name: string; description: string }>;
  pendingQuestion: PendingQuestion | null;
  taskNotice: TaskNoticeView | null;
  setupQuestions: SetupQuestionView[];
  actions: ActionView[];
  dashboardUrl: string | null;
  notebookUrl: string | null;
  handoffText: string | null;
  outroData: OutroView | null;
  frameworkContext: {
    keys: string[];
    digest: string;
    values: Record<string, unknown>;
  };
}

export interface DetectRequest {
  programId?: string;
  installDir?: string;
}

export interface RunRequest {
  programId: string;
  installDir?: string;
  frameworkContext?: Record<string, unknown>;
  skillId?: string;
}

export type ControlSurface = 'tui' | 'headless';

/** What the composition root does on the parent's behalf; the store never runs agents. */
export interface ControlHooks {
  /** Resolve credentials host side and commit them, advancing `auth`. */
  setCredentials(): Promise<void>;
  /** TUI surface: release the runner's agent start. */
  armRun(): void;
  /** Headless surface: run detection for a program, writing through setters. */
  detect(req: DetectRequest): Promise<void>;
  /** Headless surface: one independent agent run. Resolves when it ends. */
  startRun(req: RunRequest): Promise<void>;
  /** Flush and exit. Idempotent. */
  shutdown(): Promise<void>;
}
