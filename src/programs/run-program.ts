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
import type { Credentials } from '@shared/api';
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
import type { FrameworkConfig } from './framework-config';
import type { DetectedSource } from './warehouse-sources/types';
import {
  createPosthogInferenceAuthProvider,
  type CredentialsProvider,
  type ResolvedProgramCredentials,
} from './credentials';
import { refreshCredentialsIfNeeded } from './token-refresh';
import { stampAiSdkDetected } from './posthog-integration/ai-sdk-stamp';
import { getRuntimeProgramConfig } from './runtime-registry';
import { startProgramFileWatchers } from './program-file-watchers';
import { resolveProgramBinding } from './binding';
import { getProgramCommandments } from './commandments';
import { areSeededTasksEnabled, resolveStageOverrides } from './experiments';
import { captureSwitchboardDecision } from './binding-telemetry';
import type { ProgramRunDefinitionInput } from './resolve-run-definition';
import {
  resolvePosthogIntegrationRun,
  resolvePosthogIntegrationSeedTasks,
  type PosthogIntegrationRunEffects,
} from './posthog-integration/run';
import { resolveSelfDrivingRun } from './self-driving/run';
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

/** Copied when runProgram receives it; functions stay by reference. */
export interface ProgramInput extends ProgramRunDefinitionInput {
  installDir: string;
  /** Run-scoped credentials, or provide options.credentials instead. */
  credentials?: ResolvedProgramCredentials;
  /** Stable attribution supplied by a host. Generated when absent. */
  runId?: string;
  /** Data-only override for a program whose legacy recipe still takes a session. */
  run?: AgentRunDefinition;
  /** An already-resolved binding; runProgram then skips routing and its telemetry. */
  binding?: RunConfig['binding'];
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
  wizardMetadata?: Record<string, string>;
  seedTasks?: RunConfig['seedTasks'];
  hooks?: RunHooks;
  allowedTools?: RunConfig['allowedTools'];
  disallowedTools?: RunConfig['disallowedTools'];
  agentFlow?: string;
  /** A ledger the host lays over a generic program, such as an audit-family skill. */
  auditLedgerFile?: string;
  frameworkConfig?: FrameworkConfig;
  frameworkContext?: Record<string, unknown>;
  warehouseSources?: readonly DetectedSource[];
  detectedTools?: readonly DetectedSource[];
  mayReportScanResults?: boolean;
  discoveredFeatures?: readonly DiscoveredFeature[];
  /** The host already considered the AI SDK stamp for this login. */
  aiSdkStampReported?: boolean;
  /** Prepared child integration and gate decisions for a composed run. */
  composition?: {
    integration?: ProgramInput;
    handoffConfirmed?: boolean;
    githubConnected?: boolean;
  };
}

/** A pause at an existing host boundary; requests carry domain data only. */
export type ProgramWorkflowRequest =
  | {
      kind: 'post-auth';
      programId: string;
      gates: readonly { id: string; data?: unknown }[];
    }
  | {
      kind: 'confirm';
      programId: string;
      id: 'self-driving-handoff' | 'self-driving-github';
      installDir: string;
    }
  | {
      kind: 'child-run';
      programId: string;
      stepId: string;
      runProgramId: string;
      installDir: string;
    };

export type ProgramWorkflowDecision =
  | { kind: 'post-auth'; frameworkContext?: Record<string, unknown> }
  | { kind: 'confirm'; confirmed: boolean }
  /** null: the host ran the child itself. */
  | { kind: 'child-run'; input: ProgramInput | null };

/** Answers composition and post-auth pauses; without one, runProgram uses prepared input. */
export interface ProgramWorkflowConnector {
  step(
    request: ProgramWorkflowRequest,
    context: { signal: AbortSignal },
  ): Promise<ProgramWorkflowDecision>;
}

export interface ProgramOptions {
  credentials?: CredentialsProvider;
  interaction?: AgentInteraction;
  onProgress?: (progress: ProgramProgress) => void;
  workflow?: ProgramWorkflowConnector;
  /** Runs a no-agent program, such as mcp-tutorial or slack, in the host. */
  noAgentWorkflow?: (request: {
    programId: string;
    installDir: string;
    credentials?: Credentials;
    signal: AbortSignal;
  }) => Promise<{
    outcome: RunOutcome.Success | RunOutcome.Aborted;
    data?: Record<string, unknown>;
  }>;
  /** Without getNotebookUrl, the outro reads the notebook URL the run emitted. */
  integrationEffects?: PosthogIntegrationRunEffects;
  /** Wait for the host's AI-processing approval gate when org approval is absent. */
  awaitAiApproval?: (context: {
    programId: string;
    signal: AbortSignal;
  }) => Promise<boolean>;
  /** Evaluate feature flags for a run whose input carries none. */
  featureFlags?: () => Promise<WizardFlagSnapshot>;
  /** Leave new skills armed after success; the host commits them at exit. */
  deferSkillCommit?: boolean;
  signal?: AbortSignal;
}

export interface ProgramRunOutcome {
  programId: string;
  outcome: RunOutcome;
  /** Final invocation-owned authentication, detection, and composition data. */
  data: ProgramInvocationData;
  /** Each agent run's result, attributed to its run and step, in settlement order. */
  settledRuns: SettledProgramRun[];
  /** Observer failures and late events, newest last. */
  diagnostics: ProgramDiagnostic[];
  /** The data a no-agent workflow returned. */
  programData?: Record<string, unknown>;
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

/** Run a registered program from explicit inputs, with invocation-owned state. */
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
  const cleanups = new Map<string, RunSkillCleanup>();
  const captureSkills = (installDir: string) => {
    if (cleanups.has(installDir)) return;
    cleanups.set(installDir, registerRunSkillCleanup(installDir));
  };
  captureSkills(input.installDir);
  const cleanFailedInvocation = () => {
    for (const cleanup of cleanups.values()) {
      try {
        cleanup();
      } catch (error) {
        logToFile('[programs] failed-run skill cleanup error:', error);
      }
    }
  };
  try {
    const result = await runProgramWithStore(programId, input, options, {
      store,
      approval: { granted: false },
      captureSkills,
    });
    if (result.outcome !== RunOutcome.Success) cleanFailedInvocation();
    else if (!options.deferSkillCommit) {
      for (const cleanup of cleanups.values()) cleanup.commit();
    }
    return result;
  } catch (error) {
    cleanFailedInvocation();
    throw error;
  }
}

/** State one runProgram call shares with the composed runs inside it. */
type Invocation = {
  store: ProgramStore;
  approval: { granted: boolean };
  /** Record a directory's skills before a run there, so a failed invocation removes only new ones. */
  captureSkills(installDir: string): void;
};

async function runProgramWithStore(
  programId: string,
  input: ProgramInput,
  options: ProgramOptions,
  invocation: Invocation,
  stepId?: string,
): Promise<ProgramRunOutcome> {
  const { store, approval } = invocation;
  const program = getRuntimeProgramConfig(programId);
  const artifacts: ProgramRunOutcome['artifacts'] = {};
  const runId = input.runId ?? randomUUID();
  const { installDir } = input;
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

  if (!program) return fail(`Unknown program: ${programId}`);

  for (const [key, value] of Object.entries(input.frameworkContext ?? {})) {
    store.setFrameworkContext(key, value);
  }

  if (program.strategy !== 'no-agent') {
    analytics.wizardCapture('agent started', {
      integration: input.run?.integrationLabel ?? programId,
      program_id: programId,
      skill_id: input.run?.skillId ?? null,
    });
  }

  /** Await a host capability; a host abort during the wait wins over its answer. */
  const park = async <T>(work: Promise<T>): Promise<T> => {
    const value = await work;
    signal.throwIfAborted();
    return value;
  };

  let credentials = input.credentials;
  let frameworkContext = input.frameworkContext ?? {};
  let run: AgentRunDefinition | undefined | null = input.run;
  let hooks: RunHooks | undefined = input.hooks;
  let seedTasks = input.seedTasks;
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
    if (credentials) {
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
    }
    if (program.strategy === 'no-agent') {
      if (!options.noAgentWorkflow) {
        return settle(RunOutcome.Failed, {
          code: ErrorCodes.CliInteractiveRequired,
          message: `${programId} requires an interactive workflow.`,
        });
      }
      const result = await park(
        options.noAgentWorkflow({
          programId,
          installDir,
          credentials: credentials?.posthog,
          signal,
        }),
      );
      return { ...settle(result.outcome), programData: result.data };
    }
    if (!credentials)
      return fail(`Credentials are required to run ${programId}.`);

    if (
      program.requiresAi !== false &&
      !input.flags?.ci &&
      !input.flags?.signup &&
      credentials.apiUser?.organization?.is_ai_data_processing_approved !==
        true &&
      !approval.granted
    ) {
      if (!options.awaitAiApproval) {
        return fail(
          'AI processing approval is required before this program can run.',
        );
      }
      approval.granted = await park(
        options.awaitAiApproval({ programId, signal }),
      );
      if (!approval.granted) return abort('AI processing approval declined.');
    }

    const postAuthGates = program.postAuthGates ?? [];
    if (postAuthGates.length > 0 && options.workflow) {
      const decision = await askWorkflow(
        options.workflow,
        {
          kind: 'post-auth',
          programId,
          gates: postAuthGates.map((id) => ({ id })),
        },
        signal,
      );
      const patch = structuredClone(decision.frameworkContext ?? {});
      for (const [key, value] of Object.entries(patch)) {
        store.setFrameworkContext(key, value);
      }
      frameworkContext = { ...frameworkContext, ...patch };
    }

    if (program.strategy === 'self-driving') {
      const composition = input.composition ?? {};
      const workflow = options.workflow;
      // Without a connector, the prepared composition answers each confirmation.
      const confirmed = async (
        id: 'self-driving-handoff' | 'self-driving-github',
        prepared: 'handoffConfirmed' | 'githubConnected',
      ): Promise<boolean> => {
        if (!workflow) return composition[prepared] === true;
        const request = { kind: 'confirm', programId, id, installDir } as const;
        return (await askWorkflow(workflow, request, signal)).confirmed;
      };
      for (const composed of program.composedRuns ?? []) {
        // A prepared child was copied with this input. A connector's answer is
        // copied as it arrives; null means the host ran the child itself.
        let childInput = composition.integration;
        if (workflow) {
          const { input: answered } = await askWorkflow(
            workflow,
            {
              kind: 'child-run',
              programId,
              stepId: composed.stepId,
              runProgramId: composed.runProgramId,
              installDir,
            },
            signal,
          );
          childInput = answered ? snapshotProgramInput(answered) : undefined;
        }
        if (!childInput) continue;
        store.setComposition({ parentProgramId: programId });
        invocation.captureSkills(childInput.installDir);
        const childResult = await runProgramWithStore(
          composed.runProgramId,
          {
            ...childInput,
            credentials: childInput.credentials ?? credentials,
            composed: true,
            runId: childInput.runId ?? `${runId}:${composed.stepId}`,
            flags: { ...input.flags, ...childInput.flags },
            host: mergeGiven(input.host, childInput.host),
            overrides: mergeGiven(input.overrides, childInput.overrides),
            wizardFlags: mergeGiven(input.wizardFlags, childInput.wizardFlags),
            wizardFlagPayloads: mergeGiven(
              input.wizardFlagPayloads,
              childInput.wizardFlagPayloads,
            ),
          },
          options,
          invocation,
          composed.stepId,
        );
        if (childResult.outcome !== RunOutcome.Success) {
          return { ...childResult, programId };
        }
        // The child ran on this login, so a token it refreshed carries over.
        if (!childInput.credentials && childResult.data.credentials) {
          credentials = {
            ...credentials,
            posthog: childResult.data.credentials,
          };
        }
        store.markProgramCompleted(composed.stepId);
        if (!(await confirmed('self-driving-handoff', 'handoffConfirmed'))) {
          return abort('Self-driving handoff was not confirmed.');
        }
      }
      if (!(await confirmed('self-driving-github', 'githubConnected'))) {
        return abort('GitHub connection was not confirmed.');
      }
    }

    if (!input.wizardFlags && options.featureFlags) {
      flagSnapshot = await park(options.featureFlags());
    }

    if (!run && program.strategy === 'integration') {
      const effects = options.integrationEffects;
      if (!input.frameworkConfig || !effects) {
        return fail(
          'PostHog integration requires prepared framework configuration and host effects.',
        );
      }
      const resolved = await resolvePosthogIntegrationRun(
        {
          installDir,
          frameworkConfig: input.frameworkConfig,
          frameworkContext,
          typescript: input.typescript ?? false,
          additionalFeatureQueue: input.additionalFeatureQueue,
          warehouseSources: input.warehouseSources ?? [],
          flags,
          wizardFlags: { ...flagSnapshot.flags },
          mayReportScanResults: input.mayReportScanResults ?? false,
        },
        {
          ...effects,
          // The outro is built before runAgent returns, so it reads the URL
          // this run emitted, unless the host has its own live getter.
          getNotebookUrl:
            effects.getNotebookUrl ?? (() => store.activeNotebookUrl()),
        },
      );
      run = resolved.run;
      hooks ??= resolved.hooks;
      seedTasks ??= () =>
        resolvePosthogIntegrationSeedTasks({
          warehouseSources: input.warehouseSources ?? [],
          flags,
          mayReportScanResults: input.mayReportScanResults ?? false,
        });
    } else if (!run && program.strategy === 'self-driving') {
      const resolved = resolveSelfDrivingRun({
        installDir,
        detectedTools: input.detectedTools ?? [],
      });
      run = resolved.run;
      hooks ??= resolved.hooks;
    }
    if (!run) {
      if (program.strategy === 'static') run = program.run;
      if (program.strategy === 'resolved') {
        const resolutionInput: ProgramInput = { ...input, frameworkContext };
        run = program.resolve(resolutionInput);
      }
    }
    if (!run) {
      return fail(
        `Program ${programId} needs a data-only run definition before it can run without a TUI session.`,
      );
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

  const fileWatchers = startProgramFileWatchers(
    {
      ...program,
      auditLedgerFile: input.auditLedgerFile ?? program.auditLedgerFile,
    },
    installDir,
    store,
  );
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
    const binding = input.binding ?? resolveProgramBinding(switchboard);
    if (!input.binding) {
      analytics.setTag('sequence', binding.sequence);
      analytics.setTag('harness', binding.harness);
      captureSwitchboardDecision(switchboard, binding);
    }
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
      ...input.wizardMetadata,
      SEQUENCE: binding.sequence,
      HARNESS: binding.harness,
    };
    artifacts.reportFile = path.resolve(installDir, run.reportFile);
    const adapter = store.beginRun({ runId, stepId }, options.onProgress);

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
        allowedTools: input.allowedTools ?? program.allowedTools,
        disallowedTools: input.disallowedTools ?? program.disallowedTools,
        agentFlow: input.agentFlow ?? program.agentFlow,
        excludedTaskTypes: program.excludedTaskTypes,
        seedTasks,
        hooks,
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
    if (result.outcome === RunOutcome.Success) {
      store.markProgramCompleted(programId);
    }
    return settle(
      result.outcome,
      result.outcome === RunOutcome.Success ? undefined : result.failure,
    );
  } finally {
    fileWatchers.stop();
  }
}

/** A composed child inherits the parent's value; absent on both sides stays absent. */
function mergeGiven<T extends object>(parent?: T, child?: T): T | undefined {
  return parent || child ? ({ ...parent, ...child } as T) : undefined;
}

/** Ask the connector; a host abort wins, and an answer of another kind is rejected. */
async function askWorkflow<R extends ProgramWorkflowRequest>(
  workflow: ProgramWorkflowConnector,
  request: R,
  signal: AbortSignal,
): Promise<Extract<ProgramWorkflowDecision, { kind: R['kind'] }>> {
  const decision = await workflow.step(request, { signal });
  signal.throwIfAborted();
  if (decision.kind !== request.kind) {
    throw new Error(
      `Workflow connector answered ${decision.kind} to a ${request.kind} request`,
    );
  }
  return decision as Extract<ProgramWorkflowDecision, { kind: R['kind'] }>;
}
