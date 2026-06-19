/**
 * The agent-backend seam. The linear pipeline assembles a run (skill install,
 * prompt, ask bridge) and then hands off to a backend to actually drive the
 * coding agent. A backend owns the agent loop and the model transport; it does
 * NOT own bootstrap, prompt assembly, error routing, or the outro — those stay
 * in `linear.ts` so every backend shares them.
 *
 * `anthropic` (claude-agent-sdk) is the control. `pi` (pi.dev) is the
 * challenger. `selectBackend(flags)` resolves `wizard-runner` to one of them.
 */

import type { WizardSession } from '../../../wizard-session';
import type { ProgramConfig } from '../../../programs/program-step';
import type { SpinnerHandle } from '../../../../ui';
import type { WizardAskBridge } from '../../../wizard-ask-bridge';
import type { AgentErrorType } from '../../agent-interface';
import type { ProgramRun, BootstrapResult } from '../shared/types';

/** The benchmark/telemetry hook threaded through a run, if enabled. */
export interface RunMiddleware {
  onMessage(message: unknown): void;
  finalize(resultMessage: unknown, totalDurationMs: number): unknown;
}

/**
 * Everything a backend needs to run one program. Assembled by `linear.ts` from
 * the bootstrap result and the program config; the backend consumes it and
 * never re-derives run context.
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
  /** The run spinner (the backend drives start/stop). */
  spinner: SpinnerHandle;
  /** Interactive question bridge; undefined in CI/headless (ask disabled). */
  askBridge?: WizardAskBridge;
  /** Benchmark middleware, when `session.benchmark` is set. */
  middleware?: RunMiddleware;
}

/** What a backend reports back: an error classification, or nothing on success. */
export type AgentResult = { error?: AgentErrorType; message?: string };

/** A drop-in agent backend: consumes a fully-assembled run, returns a result. */
export interface AgentBackend {
  /** Stable name used for logs + telemetry (matches the flag variant). */
  readonly name: 'anthropic' | 'pi';
  run(inputs: BackendRunInputs): Promise<AgentResult>;
}
