/** A caller-owned program invocation. No TUI store or session is required. */
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- A shell: B3 fills in the body. */
import type { RunOutcome } from '@agent';
import type {
  AgentInteraction,
  AgentRunDefinition,
  RunConfig,
  RunHooks,
  RunInput,
  RunResult,
} from '@agent/types';
import type { Harness, Integration, Sequence } from '@shared/constants';
import type { DiscoveredFeature } from '@lib/wizard-session';
import type { DetectedSource } from './warehouse-sources/types';
import type {
  CredentialsProvider,
  ResolvedProgramCredentials,
} from './credentials';
import type {
  ProgramDiagnostic,
  ProgramInvocationData,
  ProgramProgress,
  SettledProgramRun,
} from './program-store';

/** Launch-time routing choices, such as the CLI's --harness, --sequence and --model. */
export type ProgramOverrides = {
  harness?: Harness; // --harness
  sequence?: Sequence; // --sequence
  model?: string; // --model
};

/** Feature flags and their payloads from one evaluation. */
export type WizardFlagSnapshot = {
  flags: Record<string, string>; // flag key to variant
  payloads: Record<string, unknown>; // flag key to payload
};

/** Program-level settings the caller reads from the program's `ProgramConfig`. */
export type ProgramSettings = {
  requiresAi?: boolean; // false skips the AI-processing approval
  agentFlow?: string; // context-mill flow; defaults to the program ID
  allowedTools?: RunConfig['allowedTools']; // added to the base tools
  disallowedTools?: RunConfig['disallowedTools']; // removed from the base tools
  excludedTaskTypes?: RunConfig['excludedTaskTypes']; // task types to skip for these flags
  postAuthGates?: readonly string[]; // steps settled after login, before the agent
};

/** Copied when runProgram receives it; credentials, run, program, hooks and seedTasks stay by reference. */
export interface ProgramInput {
  installDir: string; // the project the agent works in
  run: AgentRunDefinition; // built from the program's ProgramConfig
  program?: ProgramSettings; // from the same ProgramConfig
  credentials?: ResolvedProgramCredentials; // a login you hold; else options.credentials
  runId?: string; // labels progress and the outcome; generated when absent
  overrides?: ProgramOverrides; // launch overrides; dev and test builds only
  composed?: boolean; // true for a sub-run inside another program
  skillId?: string; // labels the run; defaults to run.skillId, then integrationLabel
  integration?: Integration | null; // the detected framework
  frameworkDocsUrl?: string; // the framework's docs page
  flags?: Partial<RunInput['flags']>; // run flags such as ci and signup
  host?: RunInput['host']; // where PostHog is
  wizardFlags?: Record<string, string>; // a flag snapshot; else options.featureFlags
  wizardFlagPayloads?: Record<string, unknown>; // payloads for wizardFlags
  seedTasks?: RunConfig['seedTasks']; // tasks queued before the planner runs
  hooks?: RunHooks; // the program's completion hooks
  warehouseSources?: readonly DetectedSource[]; // AI SDK stamp evidence
  mayReportScanResults?: boolean; // consent to send the AI SDK stamp
  discoveredFeatures?: readonly DiscoveredFeature[]; // AI SDK stamp evidence
  aiSdkStampReported?: boolean; // true skips the AI SDK stamp
}

export interface ProgramOptions {
  credentials?: CredentialsProvider; // resolves the login when input has none
  interaction?: AgentInteraction; // answers the agent's questions and notices
  onProgress?: (progress: ProgramProgress) => void; // run events and data snapshots
  awaitAiApproval?: (context: {
    programId: string;
    signal: AbortSignal;
  }) => Promise<boolean>; // asks for AI-processing approval; false aborts
  awaitPostAuthGates?: (context: {
    programId: string;
    gates: readonly string[];
    signal: AbortSignal;
  }) => Promise<void>; // waits while the caller settles the gates
  featureFlags?: () => Promise<WizardFlagSnapshot>; // loads flags when input has none
  signal?: AbortSignal; // cancels the run
}

export interface ProgramRunOutcome {
  programId: string; // the program that ran
  outcome: RunOutcome; // success, aborted, failed or crashed
  data: ProgramInvocationData; // the final login and route
  settledRuns: SettledProgramRun[]; // the agent run's result, once it ran
  diagnostics: ProgramDiagnostic[]; // observer failures and late events
  artifacts: { reportFile?: string }; // where the agent writes its report
  failure?: RunResult['failure']; // code and message on any non-success
}

/** Run an existing program from explicit inputs, with invocation-owned state. */
export async function runProgram(
  programId: string,
  callerInput: ProgramInput,
  options: ProgramOptions = {},
): Promise<ProgramRunOutcome> {
  throw new Error('runProgram: not implemented');
}
