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
 */

import type { WizardSession } from '@lib/wizard-session';
import type { AdditionalFeature } from '@lib/wizard-session';
import type { Harness } from '@lib/constants';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { SpinnerHandle } from '@ui';
import type { WizardAskBridge } from '@lib/wizard-ask-bridge';
import type { AgentErrorType } from '@lib/agent/agent-interface';
import type { OrchestratorToolsContext } from '@lib/agent/runner/sequence/orchestrator/queue-tools';
import type { EffortLevel } from '@lib/agent/runner/switchboard/models';
import type {
  ProgramRun,
  BootstrapResult,
} from '@lib/agent/runner/shared/types';

/** The benchmark/telemetry hook threaded through a run, if enabled. */
export interface RunMiddleware {
  onMessage(message: unknown): void;
  finalize(resultMessage: unknown, totalDurationMs: number): unknown;
}

/**
 * Everything a runner needs to run one program. Assembled by `linear.ts` from
 * the bootstrap result and the program config; the runner consumes it and never
 * re-derives run context.
 */
export interface BackendRunInputs {
  session: WizardSession;
  config: ProgramRun;
  programConfig: ProgramConfig;
  boot: BootstrapResult;
  /** The fully assembled prompt. */
  prompt: string;
  /** Installed framework-skill path, when the program installs one. */
  skillPath?: string;
  /** The run spinner (the runner drives start/stop). */
  spinner: SpinnerHandle;
  /** Interactive question bridge; undefined in CI/headless (ask disabled). */
  askBridge?: WizardAskBridge;
  /** Benchmark middleware, when `session.benchmark` is set. */
  middleware?: RunMiddleware;
  /** Gateway model id resolved from the (runner, model) pair. */
  model: string;
  /** Switchboard-resolved reasoning-effort override. Absent → the model's table default. */
  thinkingLevel?: EffortLevel;
}

/** What a runner reports back: an error classification, or nothing on success. */
export type AgentResult = { error?: AgentErrorType; message?: string };

/**
 * One orchestrator-mode unit of work — the seed plan, or one drained task.
 * Built by `orchestrator-runner.ts` per call. Distinct from `BackendRunInputs`
 * because the orchestrator owns its own model, tool overrides, spinner copy,
 * analytics shape, and queue-tools context per call, instead of inheriting
 * them from the program-level config the linear pipeline assembles once.
 */
export interface TaskRunInputs {
  session: WizardSession;
  programConfig: ProgramConfig;
  boot: BootstrapResult;
  /** The fully assembled per-task or seed prompt. */
  prompt: string;
  spinner: SpinnerHandle;
  /** Gateway model id resolved from the task's agent prompt. */
  model: string;
  /** Per-task tool overrides from the agent prompt's frontmatter. */
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
  /** Queue-tools context threaded into the in-process wizard-tools MCP. */
  orchestrator: OrchestratorToolsContext;
  /** Spinner copy. Empty strings suppress the per-task line (queue panel shows progress). */
  spinnerMessage: string;
  successMessage: string;
  errorMessage?: string;
  additionalFeatureQueue: readonly AdditionalFeature[];
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
