/** A caller-owned program invocation. No TUI store or session is required. */
import path from 'path';
import { randomUUID } from 'crypto';
import { buildRunTags, resolveBinding, runAgent, RunOutcome } from '@agent';
import type {
  AgentInteraction,
  AgentRunDefinition,
  ProgramBinding,
  RunConfig,
  RunHooks,
  RunInput,
  RunResult,
  SwitchboardCtx,
} from '@agent/types';
import {
  getSkillsBaseUrl,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
  type Harness,
  type Integration,
} from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import type { DiscoveredFeature } from '@lib/wizard-session';
import { analytics, groupsFromUser } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type { DetectedSource } from './warehouse-sources/types';
import type {
  CredentialsProvider,
  ResolvedProgramCredentials,
} from './credentials';
import { refreshCredentialsIfNeeded } from './authenticate';
import { stampAiSdkDetected } from './posthog-integration/detect';
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

/** Fields that carry functions or class instances; everything else is data. */
const KEPT_BY_REFERENCE = [
  'credentials',
  'run',
  'program',
  'hooks',
  'seedTasks',
] as const satisfies readonly (keyof ProgramInput)[];

/** Copy the host's input, so a later host write cannot reach the run or its hooks. */
function snapshotProgramInput(input: ProgramInput): ProgramInput {
  const data: Partial<ProgramInput> = { ...input };
  for (const key of KEPT_BY_REFERENCE) delete data[key];
  return { ...input, ...structuredClone(data) };
}

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

  // Resolve which sequence and harness run the program (CLI → PostHog flag →
  // per-program binding → default) and tag both axes onto analytics.
  const switchboard: SwitchboardCtx = {
    program: programId,
    composed: input.composed ?? false,
    flags: wizardFlags,
    flagPayloads: wizardFlagPayloads,
    cliHarness: input.overrides?.harness,
    cliSequence: input.overrides?.sequence,
    cliModel: input.overrides?.model,
  };
  const binding = resolveBinding(switchboard);
  analytics.setTag('sequence', binding.sequence);
  analytics.setTag('harness', binding.harness);
  captureSwitchboardDecision(switchboard, binding);
  store.setBinding(binding);

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
      switchboard,
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
      project: credentials.project,
      apiUser: credentials.apiUser,
      skillId: input.skillId ?? run.skillId ?? run.integrationLabel,
      integration: input.integration,
      frameworkDocsUrl: input.frameworkDocsUrl,
      flags,
      host: { ...input.host },
    },
    {
      interaction: options.interaction,
      onProgress: (event) => adapter.onProgress(event),
      signal: options.signal,
    },
  );
  adapter.finish(result);
  return settle(
    result.outcome,
    result.outcome === RunOutcome.Success ? undefined : result.failure,
  );
}

/**
 * One event + one log line per run: what entered the switchboard, which
 * precedence rung decided each axis, and the final pick.
 */
function captureSwitchboardDecision(
  ctx: SwitchboardCtx,
  binding: ProgramBinding,
): void {
  const trace = ctx.trace ?? {};
  // Unpinned orchestrator runs choose a model per task from the context-mill agent prompts; the orchestrator logs that map once the prompts load.
  const perTaskModel =
    binding.sequence === Sequence.orchestrator && trace.model === 'binding';
  const model = perTaskModel ? 'chosen-per-task' : binding.model;
  const modelSource = perTaskModel ? 'agent-prompts' : trace.model;
  analytics.wizardCapture('switchboard resolved', {
    program: ctx.program,
    flag_self_driving_use_pi_harness:
      ctx.flags[WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY],
    flag_self_driving_pi_payload: JSON.stringify(
      ctx.flagPayloads?.[WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY] ?? null,
    ),
    flag_orchestrator: ctx.flags[WIZARD_ORCHESTRATOR_FLAG_KEY],
    cli_harness: ctx.cliHarness,
    cli_sequence: ctx.cliSequence,
    cli_model: ctx.cliModel,
    harness_source: trace.harness,
    model_source: modelSource,
    sequence_source: trace.sequence,
    harness: binding.harness,
    model,
    thinking_level: binding.thinkingLevel,
    sequence: binding.sequence,
  });
  logToFile(
    `[switchboard] decision: program=${ctx.program}` +
      ` in(orchestrator=${ctx.flags[WIZARD_ORCHESTRATOR_FLAG_KEY] ?? '-'},` +
      ` cli=${ctx.cliHarness ?? '-'}/${ctx.cliSequence ?? '-'}/${
        ctx.cliModel ?? '-'
      })` +
      ` → harness=${binding.harness} (${trace.harness ?? '?'})` +
      ` model=${model} (${modelSource ?? '?'})` +
      ` sequence=${binding.sequence} (${trace.sequence ?? '?'})`,
  );
}
