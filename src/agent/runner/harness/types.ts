/**
 * The agent-runner seam. The linear pipeline assembles a run (skill install,
 * prompt, ask bridge) and then hands off to a runner to actually drive the
 * coding agent. A runner owns the agent loop and the model transport; it does
 * NOT own bootstrap, prompt assembly, error routing, or the outro — those stay
 * in `linear.ts` so every runner shares them.
 *
 * `anthropic` (claude-agent-sdk) is the control. `pi` (pi.dev) is the
 * challenger. The harness is chosen by `resolveHarness` in `switchboard.ts`.
 *
 * Orchestrator mode (the experimental task-queue pipeline) drives the harness
 * through the OPTIONAL `runTask` method below — one call per seed plan and one
 * per drained task. A harness without orchestrator support omits the method;
 * `orchestrator-runner.ts` checks for it at the call site and fails loudly
 * rather than silently downgrading.
 *
 * A harness reports through `emit` and never reaches for a UI. It returns an
 * tagged success, abort, or failure data for the sequence to decide.
 */

import type { Harness } from '@shared/constants';
import type { WizardAskBridge } from '@agent/wizard-ask-bridge';
import type { AgentErrorType } from '@agent/agent-interface';
import type { ProgressEmitter, SpinnerHandle } from '@agent/progress';
import type { OrchestratorToolsContext } from '@agent/runner/sequence/orchestrator/queue-tools';
import type {
  EffortLevel,
  ThinkingLevel,
} from '@agent/runner/switchboard/models';
import type {
  AgentFailure,
  BootstrapResult,
  RunConfig,
  RunInput,
} from '@agent/runner/shared/types';

/** The benchmark/telemetry hook threaded through a run, if enabled. */
export interface RunMiddleware {
  onMessage(message: unknown): void;
  finalize(resultMessage: unknown, totalDurationMs: number): unknown;
}

/**
 * Everything a runner needs to run one program. Assembled by `linear.ts` from
 * the prepared run and the run config; the runner consumes it and never
 * re-derives run context.
 */
export interface BackendRunInputs {
  config: RunConfig;
  input: RunInput;
  boot: BootstrapResult;
  emit: ProgressEmitter;
  signal?: AbortSignal;
  /** The fully assembled prompt. */
  prompt: string;
  /** Installed framework-skill path, when the program installs one. */
  skillPath?: string;
  /** The run spinner (the runner drives start/stop). */
  spinner: SpinnerHandle;
  /** Interactive question bridge; undefined in CI/headless (ask disabled). */
  askBridge?: WizardAskBridge;
  /** Benchmark middleware, when `--benchmark` is set. */
  middleware?: RunMiddleware;
  /** Gateway model id resolved from the (runner, model) pair. */
  model: string;
  /** Switchboard-resolved reasoning-effort override. Absent → the model's table default. */
  thinkingLevel?: EffortLevel;
}

/**
 * A harness reports one terminal outcome. A decided failure already has the
 * caller-visible code and message; the caller alone presents it.
 */
export type AgentResult =
  | { kind: 'success' }
  | {
      kind: 'abort';
      classification: AgentErrorType.ABORT;
      message?: string;
      error?: Error;
    }
  | {
      kind: 'failure';
      classification: Exclude<AgentErrorType, AgentErrorType.ABORT>;
      message?: string;
      error?: Error;
    }
  | { kind: 'decided_failure'; failure: AgentFailure };

/**
 * One orchestrator-mode unit of work — the seed plan, or one drained task.
 * Built by `orchestrator-runner.ts` per call. Distinct from `BackendRunInputs`
 * because the orchestrator owns its own model, tool overrides, spinner copy,
 * analytics shape, and queue-tools context per call, instead of inheriting
 * them from the program-level config the linear pipeline assembles once.
 */
export interface TaskRunInputs {
  config: RunConfig;
  input: RunInput;
  boot: BootstrapResult;
  emit: ProgressEmitter;
  signal?: AbortSignal;
  /** The fully assembled per-task or seed prompt. */
  prompt: string;
  spinner: SpinnerHandle;
  /** Gateway model id resolved from the task's agent prompt. */
  model: string;
  /** Reasoning effort from the agent prompt's per-profile frontmatter; overrides
   * the model's table default when set. */
  effort?: ThinkingLevel;
  /** Per-task tool overrides from the agent prompt's frontmatter. */
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
  /**
   * Interactive question bridge, passed only for a task whose prompt allows
   * `wizard_ask`. Absent everywhere else, so a task that was never meant to ask
   * cannot open an overlay while its neighbours run.
   */
  askBridge?: WizardAskBridge;
  /** Queue-tools context threaded into the in-process wizard-tools MCP. */
  orchestrator: OrchestratorToolsContext;
  /** Spinner copy. Empty strings suppress the per-task line (queue panel shows progress). */
  spinnerMessage: string;
  successMessage: string;
  errorMessage?: string;
  /** Whether to request the end-of-run reflection remark (fired once, on the last task). */
  requestRemark: boolean;
  /** Per-call analytics properties merged into `agent completed` / `agent aborted` events. */
  analyticsProperties: Record<string, unknown>;
}

/** A drop-in agent runner: consumes a fully-assembled run, returns a result. */
export interface AgentHarness {
  /** Stable name used for logs + telemetry (matches the flag variant). */
  readonly name: Harness;
  run(inputs: BackendRunInputs): Promise<AgentResult>;
  /**
   * Drive one orchestrator-mode unit of work. Optional — a harness that has
   * not yet implemented orchestrator support omits this method. The
   * orchestrator runner checks for presence at the call site and throws
   * explicitly when the resolved harness can't run a task.
   */
  runTask?(inputs: TaskRunInputs): Promise<AgentResult>;
}
