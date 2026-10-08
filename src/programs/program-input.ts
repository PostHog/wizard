/** The `runProgram` contract: what a caller passes in, the capabilities it may supply, and what comes back. */
import type { RunOutcome } from '@shared/run-state';
import type {
  AgentInteraction,
  AgentProgress,
  RunResult,
  ProgramInvocation,
} from '@agent/types';
import type { SettingsConflict } from '@shared/claude-settings';
import type { WizardReadinessResult } from '@shared/health-checks/readiness';
import type {
  CredentialsProvider,
  ResolvedProgramCredentials,
} from './credentials';
import type { ProgramConfig, ProgramId } from './program-step';
import type { SessionStore } from './session/session-store';

/** Feature flags and their payloads from one evaluation. */
export type WizardFlagSnapshot = {
  flags: Record<string, string>; // flag key to variant
  payloads: Record<string, unknown>; // flag key to payload
};

/** What one invocation runs on. The caller owns the store; `runProgram` writes the run into it. */
export interface ProgramInput {
  invocation?: ProgramInvocation;
  store: SessionStore; // launch values, detection results and run state
  config?: Partial<ProgramConfig>; // laid over the registered config
  credentials?: ResolvedProgramCredentials; // a login you hold; else the store's, else options.credentials
  runId?: string; // labels the program's own run; generated when absent
  composed?: boolean; // true for a run inside another's: its caller writes the success outro; a failure still records its error outro and the phase, a caller cancel its cancel outro
  wizardFlags?: Record<string, string>; // a flag snapshot; else options.featureFlags
  wizardFlagPayloads?: Record<string, unknown>; // payloads for wizardFlags
}

/** A point where the run waits on the host. */
export type ProgramStep =
  // An agent run: a composed sub-run from `runSteps`, or the program's own, `run`.
  | { kind: 'run'; stepId: string; programId: ProgramId }
  // The organization hasn't approved AI processing.
  | { kind: 'ai-approval'; programId: ProgramId; installDir: string }
  // A service the run needs is down.
  | {
      kind: 'service-outage';
      programId: ProgramId;
      installDir: string;
      readiness: WizardReadinessResult;
    }
  // A Claude settings file redirects the agent and can't be neutralized; `fix` backs it up and removes it.
  | {
      kind: 'settings-conflict';
      programId: ProgramId;
      installDir: string;
      conflicts: SettingsConflict[];
      fix: () => boolean;
    };

/** The host's decisions, as data in and a yes or no out. */
export interface ProgramWorkflowConnector {
  /** Resolve true to go on: run the step, accept, continue past the outage, or run with the conflict fixed. */
  confirmStep(
    step: ProgramStep,
    context: { signal: AbortSignal },
  ): Promise<boolean>;
  /** An agent run step settled. */
  finishStep?(
    step: Extract<ProgramStep, { kind: 'run' }>,
    result: RunResult,
  ): void;
}

export interface ProgramOptions {
  credentials?: CredentialsProvider; // resolves the login when neither input nor the store has one
  interaction?: AgentInteraction; // answers the agent's questions and notices; absent means no asks
  onProgress?: (progress: ProgramProgress) => void; // every event, copied, in order, never awaited
  workflow?: ProgramWorkflowConnector; // the host's steps; absent runs only the program's own run
  featureFlags?: () => Promise<WizardFlagSnapshot>; // loads flags when input has none
  signal?: AbortSignal; // cancels the run
}

/** One progress event, labelled with the agent run and host step it came from. */
export type ProgramProgress = {
  runId: string;
  stepId?: string;
  event: AgentProgress;
};

/** A progress observer that threw, or an event after its run settled, kept instead of breaking the run. */
export type ProgramDiagnostic = {
  runId: string;
  eventKind: AgentProgress['kind'];
  message: string;
};

export interface ProgramRunOutcome {
  programId: string; // the program that ran
  outcome: RunOutcome; // success, aborted, failed or crashed
  runResults: RunResult[]; // one per agent run, in order
  artifacts: { reportFile?: string }; // where the program's own run writes its report
  failure?: RunResult['failure']; // code and message on any non-success
  diagnostics: ProgramDiagnostic[]; // observer failures and late events
}
