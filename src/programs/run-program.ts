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
import type { AuditCheck } from '@shared/audit-ledger';
import type { Harness, Integration, Sequence } from '@shared/constants';
import type { DiscoveredFeature } from '@shared/scan-consent';
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
  harness?: Harness;
  sequence?: Sequence;
  model?: string;
};

/** Feature flags and their payloads from one evaluation. */
export type WizardFlagSnapshot = {
  flags: Record<string, string>;
  payloads: Record<string, unknown>;
};

/** Program-level settings the caller reads from the program's `ProgramConfig`. */
export type ProgramSettings = {
  /** False for a program whose run needs no AI-processing approval. */
  requiresAi?: boolean;
  agentFlow?: string;
  allowedTools?: RunConfig['allowedTools'];
  disallowedTools?: RunConfig['disallowedTools'];
  excludedTaskTypes?: RunConfig['excludedTaskTypes'];
  auditLedgerFile?: string;
  /** Written to the audit ledger before the agent starts. */
  auditSeedChecks?: readonly AuditCheck[];
  eventPlanFile?: string;
  /** Steps the host settles after auth and before the agent starts. */
  postAuthGates?: readonly string[];
};

/** Copied when runProgram receives it; functions stay by reference. */
export interface ProgramInput {
  installDir: string;
  /** The program's run definition, built by the caller from its `ProgramConfig`. */
  run: AgentRunDefinition;
  program?: ProgramSettings;
  /** Run-scoped credentials, or provide options.credentials instead. */
  credentials?: ResolvedProgramCredentials;
  /** Stable attribution supplied by a host. Generated when absent. */
  runId?: string;
  overrides?: ProgramOverrides;
  composed?: boolean;
  skillId?: string;
  integration?: Integration | null;
  frameworkDocsUrl?: string;
  flags?: Partial<RunInput['flags']>;
  host?: RunInput['host'];
  /** Evaluated flags; when absent, runProgram asks options.featureFlags. */
  wizardFlags?: Record<string, string>;
  wizardFlagPayloads?: Record<string, unknown>;
  seedTasks?: RunConfig['seedTasks'];
  hooks?: RunHooks;
  warehouseSources?: readonly DetectedSource[];
  mayReportScanResults?: boolean;
  discoveredFeatures?: readonly DiscoveredFeature[];
  /** The host already considered the AI SDK stamp for this login. */
  aiSdkStampReported?: boolean;
}

export interface ProgramOptions {
  credentials?: CredentialsProvider;
  interaction?: AgentInteraction;
  onProgress?: (progress: ProgramProgress) => void;
  /** Wait for the host's AI-processing approval gate when org approval is absent. */
  awaitAiApproval?: (context: {
    programId: string;
    signal: AbortSignal;
  }) => Promise<boolean>;
  /** Wait while the host settles the program's post-auth gates, such as a project picker. */
  awaitPostAuthGates?: (context: {
    programId: string;
    gates: readonly string[];
    signal: AbortSignal;
  }) => Promise<void>;
  /** Evaluate feature flags for a run whose input carries none. */
  featureFlags?: () => Promise<WizardFlagSnapshot>;
  /** Leave new skills armed after success; the host commits them at exit. */
  deferSkillCommit?: boolean;
  signal?: AbortSignal;
}

export interface ProgramRunOutcome {
  programId: string;
  outcome: RunOutcome;
  /** Final invocation-owned authentication and program-file data. */
  data: ProgramInvocationData;
  /** The agent run's result, attributed to its run, once it settled. */
  settledRuns: SettledProgramRun[];
  /** Observer failures and late events, newest last. */
  diagnostics: ProgramDiagnostic[];
  artifacts: { reportFile?: string };
  failure?: RunResult['failure'];
}

/** Run an existing program from explicit inputs, with invocation-owned state. */
export async function runProgram(
  programId: string,
  hostInput: ProgramInput,
  options: ProgramOptions = {},
): Promise<ProgramRunOutcome> {
  throw new Error('runProgram: not implemented');
}
