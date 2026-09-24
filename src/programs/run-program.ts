/** A caller-owned program invocation. No TUI store or session is required. */
import path from 'path';
import { randomUUID } from 'crypto';
import { runAgent, RunOutcome } from '@agent';
import type {
  AgentInteraction,
  AgentRunDefinition,
  RunConfig,
  RunHooks,
  RunInput,
  RunResult,
} from '@agent/types';
import { getSkillsBaseUrl } from '@shared/constants';
import type { AuditCheck } from '@shared/audit-ledger';
import type { Harness, Integration, Sequence } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import { buildRunTags } from '@shared/run-tags';
import {
  registerRunSkillCleanup,
  type RunSkillCleanup,
} from '@shared/skill-run-cleanup';
import type { DiscoveredFeature } from '@shared/scan-consent';
import { analytics, groupsFromUser } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type { DetectedSource } from './warehouse-sources/types';
import {
  createPosthogInferenceAuthProvider,
  type CredentialsProvider,
  type ResolvedProgramCredentials,
} from './credentials';
import { refreshCredentialsIfNeeded } from './token-refresh';
import { stampAiSdkDetected } from './posthog-integration/ai-sdk-stamp';
import { startProgramFileWatchers } from './program-file-watchers';
import { resolveProgramBinding } from './binding';
import { getProgramCommandments } from './commandments';
import { areSeededTasksEnabled, resolveStageOverrides } from './experiments';
import { captureSwitchboardDecision } from './binding-telemetry';
import { snapshotProgramInput } from './snapshot-program-input';
import {
  ProgramStore,
  type ProgramDiagnostic,
  type ProgramInvocationData,
  type ProgramProgress,
  type SettledProgramRun,
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

/** Handed to host capabilities when the caller supplied no signal. */
const NEVER_ABORTED = new AbortController().signal;

const DEFAULT_FLAGS: RunInput['flags'] = {
  ci: false,
  signup: false,
  debug: false,
  e2eAsk: false,
  localMcp: false,
  captureAio: false,
  benchmark: false,
  yaraReport: false,
};

/** Run an existing program from explicit inputs, with invocation-owned state. */
export async function runProgram(
  programId: string,
  hostInput: ProgramInput,
  options: ProgramOptions = {},
): Promise<ProgramRunOutcome> {
  const input = snapshotProgramInput(hostInput);
  const store = new ProgramStore({
    aiSdkStampReported: input.aiSdkStampReported,
    onData: options.onProgress,
  });
  // Registered, so a process drain mid-run (wizardAbort, a signal) removes new skills too.
  const skills = registerRunSkillCleanup(input.installDir);
  try {
    const result = await runWithStore(programId, input, options, store);
    if (result.outcome !== RunOutcome.Success) cleanFailedRun(skills);
    else if (!options.deferSkillCommit) skills.commit();
    return result;
  } catch (error) {
    cleanFailedRun(skills);
    throw error;
  }
}

function cleanFailedRun(skills: RunSkillCleanup): void {
  try {
    skills();
  } catch (error) {
    logToFile('[programs] failed-run skill cleanup error:', error);
  }
}

async function runWithStore(
  programId: string,
  input: ProgramInput,
  options: ProgramOptions,
  store: ProgramStore,
): Promise<ProgramRunOutcome> {
  const { installDir, run } = input;
  const program = input.program ?? {};
  const artifacts: ProgramRunOutcome['artifacts'] = {};
  const runId = input.runId ?? randomUUID();
  const signal = options.signal ?? NEVER_ABORTED;

  const settle = (
    outcome: RunOutcome,
    failure?: RunResult['failure'],
  ): ProgramRunOutcome => ({
    programId,
    outcome,
    data: store.readData(),
    settledRuns: store.settledRuns(),
    diagnostics: store.readDiagnostics(),
    artifacts,
    ...(failure && { failure }),
  });
  const fail = (message: string) =>
    settle(RunOutcome.Failed, { code: ErrorCodes.InternalUnhandled, message });
  const abort = (message: string) =>
    settle(RunOutcome.Aborted, { code: ErrorCodes.AgentAbort, message });
  const cancelled = () => abort('Run cancelled by host.');

  if (signal.aborted) return cancelled();

  analytics.wizardCapture('agent started', {
    integration: run.integrationLabel,
    program_id: programId,
    skill_id: run.skillId ?? null,
  });

  /** Await a host capability; a host abort during the wait wins over its answer. */
  const park = async <T>(work: Promise<T>): Promise<T> => {
    const value = await work;
    signal.throwIfAborted();
    return value;
  };

  let credentials = input.credentials;
  const flags = { ...DEFAULT_FLAGS, ...input.flags };
  let flagSnapshot: WizardFlagSnapshot = {
    flags: { ...input.wizardFlags },
    payloads: { ...input.wizardFlagPayloads },
  };
  // Everything before the agent starts: a rejection fails the run, unless the host aborted.
  try {
    if (!credentials && options.credentials) {
      credentials = await park(
        options.credentials.resolve(programId, { signal }),
      );
    }
    if (!credentials)
      return fail(`Credentials are required to run ${programId}.`);
    store.setAuthenticated({
      credentials: credentials.posthog,
      apiProject: credentials.project,
      apiUser: credentials.apiUser,
    });
    // Identify before flags are evaluated, so flags can target the user.
    if (credentials.apiUser) analytics.identifyUser(credentials.apiUser);
    analytics.setGroups(
      groupsFromUser(credentials.apiUser, credentials.posthog.host.apiHost),
    );
    if (!store.readData().aiSdkStampReported) {
      store.setAiSdkStampReported();
      stampAiSdkDetected({
        apiUser: credentials.apiUser,
        discoveredFeatures: input.discoveredFeatures ?? [],
        warehouseSources: input.warehouseSources ?? [],
        mayReportScanResults: input.mayReportScanResults ?? false,
      });
    }

    if (
      program.requiresAi !== false &&
      !flags.ci &&
      !flags.signup &&
      credentials.apiUser?.organization?.is_ai_data_processing_approved !== true
    ) {
      if (!options.awaitAiApproval) {
        return fail(
          'AI processing approval is required before this program can run.',
        );
      }
      const approved = await park(
        options.awaitAiApproval({ programId, signal }),
      );
      if (!approved) return abort('AI processing approval declined.');
    }

    const gates = program.postAuthGates ?? [];
    if (gates.length > 0 && options.awaitPostAuthGates) {
      await park(options.awaitPostAuthGates({ programId, gates, signal }));
    }

    if (!input.wizardFlags && options.featureFlags) {
      flagSnapshot = await park(options.featureFlags());
    }

    // The agent can't swap tokens mid-run, so freshness is measured after every
    // park above, right before the agent mints.
    const refreshed = await park(
      refreshCredentialsIfNeeded(credentials.posthog, {
        baseUrl: input.host?.baseUrl,
      }),
    );
    if (refreshed !== credentials.posthog) {
      credentials = { ...credentials, posthog: refreshed };
      store.setAuthenticated({
        credentials: refreshed,
        apiProject: credentials.project,
        apiUser: credentials.apiUser,
      });
    }
  } catch (error) {
    if (signal.aborted) return cancelled();
    return fail(error instanceof Error ? error.message : String(error));
  }
  const wizardFlags = { ...flagSnapshot.flags };
  const wizardFlagPayloads = { ...flagSnapshot.payloads };

  const fileWatchers = startProgramFileWatchers(program, installDir, store);
  try {
    fileWatchers.seedAuditLedger();

    const switchboard = {
      program: programId,
      composed: input.composed ?? false,
      flags: wizardFlags,
      flagPayloads: wizardFlagPayloads,
      cliHarness: input.overrides?.harness,
      cliSequence: input.overrides?.sequence,
      cliModel: input.overrides?.model,
    };
    const binding = resolveProgramBinding(switchboard);
    analytics.setTag('sequence', binding.sequence);
    analytics.setTag('harness', binding.harness);
    captureSwitchboardDecision(switchboard, binding);
    store.setBinding(binding);

    const inferenceAuth =
      credentials.inferenceAuth ??
      createPosthogInferenceAuthProvider(credentials.posthog, programId);
    const wizardMetadata = {
      ...buildRunTags({
        programId,
        integration: run.integrationLabel,
        runId: analytics.runId,
        build: analytics.build,
        skillId: run.skillId,
      }),
      SEQUENCE: binding.sequence,
      HARNESS: binding.harness,
    };
    artifacts.reportFile = path.resolve(installDir, run.reportFile);
    const adapter = store.beginRun(runId, options.onProgress);

    const result = await runAgent(
      {
        programId,
        run,
        composed: input.composed ?? false,
        binding,
        programCommandments: getProgramCommandments(programId),
        stageOverrides: resolveStageOverrides(
          programId,
          wizardFlags,
          wizardFlagPayloads,
        ),
        seededTasksEnabled: areSeededTasksEnabled(wizardFlags),
        skillsBaseUrl: getSkillsBaseUrl(),
        wizardFlags,
        wizardFlagPayloads,
        wizardMetadata,
        allowedTools: program.allowedTools,
        disallowedTools: program.disallowedTools,
        agentFlow: program.agentFlow,
        excludedTaskTypes: program.excludedTaskTypes,
        seedTasks: input.seedTasks,
        hooks: input.hooks,
      },
      {
        installDir,
        credentials: credentials.posthog,
        inferenceAuth,
        project: credentials.project,
        apiUser: credentials.apiUser,
        skillId: input.skillId ?? run.skillId ?? run.integrationLabel,
        integration: input.integration,
        frameworkDocsUrl: input.frameworkDocsUrl,
        flags,
        host: { ...input.host },
      } as RunInput,
      {
        interaction: options.interaction,
        onProgress: (event) => adapter.onProgress(event),
        signal: options.signal,
      },
    );
    adapter.finish(result);
    fileWatchers.refresh();
    return settle(
      result.outcome,
      result.outcome === RunOutcome.Success ? undefined : result.failure,
    );
  } finally {
    fileWatchers.stop();
  }
}
