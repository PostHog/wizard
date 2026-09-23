/** Wire shapes of the control API, and what a surface hands the server. */

/** A registered program id; the server validates it against the registry. */
type ProgramId = string;

/** Which operations the socket accepts: current interactions only, or also raw setters. */
export type ControlMode = 'partial' | 'full';

export type ControlSurface = 'tui' | 'headless';

/** One commit legal on the current screen or interrupt, as a user's key handler makes it. */
export interface ControlAction {
  /** Stable id named in `POST /actions/<id>`. */
  id: string;
  description: string;
  /** Parameter name to a human/type hint. Absent means no params. */
  params?: Record<string, string>;
  /** Validate the params and commit through the store. */
  apply: (params: Record<string, unknown>) => void;
}

/** An action as the wire carries it: no closure. */
export type ActionView = Omit<ControlAction, 'apply'>;

/** One owned-store setter a full-control parent may call by name, whatever the screen. */
export interface ControlSetter {
  /** The store member `POST /store/<name>` calls. */
  name: string;
  description: string;
  /** Parameter name to a human/type hint. Absent means no params. */
  params?: Record<string, string>;
  /** Validate the params and call exactly that setter. */
  apply: (params: Record<string, unknown>) => void;
}

/** A setter as the wire carries it: no closure. */
export type SetterView = Omit<ControlSetter, 'apply'>;

/** A raw setter call; the state lists them so a parent can tell written state from run state. */
export interface ControlWrite {
  setter: string;
  at: string;
}

/** The store as a parent reads it; no token, key, user record, or answer value is ever projected. */
export interface ControlState {
  version: number;
  mode: ControlMode;
  currentScreen: string | null;
  /** The listed session fields, credentials only as a flag and a project id. */
  session: Record<string, unknown>;
  tasks: Array<{ label: string; status: string }>;
  statusMessages: string[];
  eventPlan: Array<{ name: string; description: string }>;
  handoffText: string | null;
  /** Setup questions the session has not answered yet. */
  setupQuestions: Array<{
    key: string;
    message: string;
    options: Array<{ label: string; value: string }>;
  }>;
  /** The commits legal on `currentScreen`. */
  actions: ActionView[];
  /** Raw setter calls since the process started; empty unless full control wrote state. */
  controlWrites: ControlWrite[];
}

/** What a surface's store exposes to the server. */
export interface ControlTarget {
  /** Increments on every committed change. */
  version(): number;
  subscribe(listener: () => void): () => void;
  /** The projected state, without `mode`, `actions` or `controlWrites`, which the server adds. */
  readState(): Omit<ControlState, 'mode' | 'actions' | 'controlWrites'>;
  /** Commits legal on the current screen or interrupt. */
  actions(): ControlAction[];
  /** Every owned-store setter full control may call. */
  setters(): ControlSetter[];
  /** True while an agent run is in flight in this store. */
  runInFlight(): boolean;
  /** Whether the session holds an API key the credentials hook can resolve. */
  hasApiKey(): boolean;
  /** The directory relative install dirs resolve against. */
  installDir(): string;
}

export type DetectRequest = { programId?: ProgramId; installDir?: string };

/** The run-config fields a request may lay over the program's; functions never cross the wire. */
export type RunConfigOverlay = {
  agentFlow?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  requiresAi?: boolean;
  reportFile?: string;
  eventPlanFile?: string;
  streamWorkflowId?: string;
};

export type RunRequest = {
  programId: ProgramId;
  config?: RunConfigOverlay;
  installDir: string;
  frameworkContext?: Record<string, unknown>;
  skillId?: string;
};

/** The `POST /runs` body: a skill alone runs on the generic skill program. */
export type RunStartBody = Omit<RunRequest, 'programId' | 'installDir'> & {
  programId?: ProgramId;
  installDir?: string;
};

/** One agent run this process served. Only `POST /runs` creates one; setters never do. */
export interface RunRecord {
  runId: string;
  programId: ProgramId;
  skillId: string | null;
  installDir: string;
  status: 'running' | 'done' | 'failed';
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** The state as `GET /state` read it when the run settled. */
  result: ControlState | null;
}

export interface HealthResponse {
  ok: true;
  version: string;
  surface: ControlSurface;
  mode: ControlMode;
  pid: number;
  program: string;
}

/** What the composition root does on the parent's behalf; the store never runs agents. */
export interface ControlHooks {
  /** Resolve API-key credentials host side and commit them. */
  setCredentials(): Promise<void>;
  /** Headless surface: run detection for a program, writing through setters. */
  detect?(req: DetectRequest): Promise<void>;
  /** Headless surface: one agent run. Resolves when it settles. */
  startRun?(req: RunRequest): Promise<void>;
  /** Flush and exit. Idempotent. */
  shutdown(): Promise<void>;
}
