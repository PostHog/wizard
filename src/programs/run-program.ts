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
import type { Harness, Integration, Sequence } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import { buildRunTags } from '@shared/run-tags';
import { captureRunSkillCleanup } from '@shared/skill-run-cleanup';
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
import {
  runNoAgentProgram,
  type NoAgentMcpPort,
  type NoAgentProgramOptions,
} from './no-agent';
import type { ProgramRunDefinitionInput } from './resolve-run-definition';
import {
  resolvePosthogIntegrationRun,
  type PosthogIntegrationRunEffects,
} from './posthog-integration/run';
import { resolveSelfDrivingRun } from './self-driving/run';
import {
  ProgramStore,
  type ProgramInvocationData,
  type ProgramProgress,
  type ProgramStoreProjection,
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
  mcp?: { features?: string[]; apiKey?: string };
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
  mcp?: NoAgentMcpPort;
  workflow?: ProgramWorkflowConnector;
  noAgentWorkflow?: NoAgentProgramOptions['workflow'];
  integrationEffects?: PosthogIntegrationRunEffects;
  /** Wait for the host's AI-processing approval gate when org approval is absent. */
  awaitAiApproval?: (context: {
    programId: string;
    signal: AbortSignal;
  }) => Promise<boolean>;
  /** Evaluate feature flags for a run whose input carries none. */
  featureFlags?: () => Promise<WizardFlagSnapshot>;
  signal?: AbortSignal;
}

export interface ProgramRunOutcome {
  programId: string;
  outcome: RunOutcome;
  runResults: RunResult[];
  /** Final invocation-owned authentication, detection, and composition data. */
  data: ProgramInvocationData;
  /** Snapshot of each agent run's attributed progress. */
  progress: ProgramStoreProjection;
  /** Actual completed agent invocations, in settlement order. */
  settledRuns: SettledProgramRun[];
  /** Program-specific outcome data, such as doctor issues or MCP client results. */
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
  input: ProgramInput,
  options: ProgramOptions = {},
): Promise<ProgramRunOutcome> {
  const store = new ProgramStore(
    { aiSdkStampReported: input.aiSdkStampReported },
    { onData: options.onProgress },
  );
  const cleanups = new Map<string, () => void>();
  const captureSkills = (installDir: string) => {
    if (cleanups.has(installDir)) return;
    cleanups.set(installDir, captureRunSkillCleanup(installDir));
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
  const signal = options.signal ?? NEVER_ABORTED;

  const fail = (message: string): ProgramRunOutcome => ({
    programId,
    outcome: RunOutcome.Failed,
    runResults: store.results(),
    data: store.readData(),
    progress: store.read(),
    settledRuns: store.settledRuns(),
    artifacts,
    failure: { code: ErrorCodes.InternalUnhandled, message },
  });
  const abort = (message: string): ProgramRunOutcome => ({
    ...fail(message),
    outcome: RunOutcome.Aborted,
    failure: { code: ErrorCodes.AgentAbort, message },
  });
  const cancelled = (): ProgramRunOutcome => ({
    ...abort('Run cancelled by host.'),
    failure: { code: ErrorCodes.AgentAbort, message: 'Run cancelled by host.' },
  });

  if (signal.aborted) return cancelled();

  if (!program) return fail(`Unknown program: ${programId}`);

  if (input.integration !== undefined || input.typescript !== undefined) {
    store.setDetection({
      integration: input.integration,
      typescript: input.typescript,
      complete: input.frameworkConfig !== undefined,
    });
  }
  for (const [key, value] of Object.entries(input.frameworkContext ?? {})) {
    store.setFrameworkContext(key, value);
  }

  let credentials = input.credentials;
  if (!credentials && options.credentials) {
    try {
      credentials = await options.credentials.resolve(programId, { signal });
    } catch (error) {
      if (signal.aborted) return cancelled();
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
  if (signal.aborted) return cancelled();
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
    const result = await runNoAgentProgram(
      programId,
      {
        installDir: input.installDir,
        credentials: credentials?.posthog,
        mcp: { ...input.mcp, local: input.flags?.localMcp },
      },
      {
        mcp: options.mcp,
        workflow: options.noAgentWorkflow,
        signal: options.signal,
      },
    );
    if (signal.aborted) return cancelled();
    return {
      programId,
      outcome:
        result.outcome === 'interactive-required'
          ? RunOutcome.Failed
          : (result.outcome as RunOutcome),
      runResults: [],
      data: store.readData(),
      progress: store.read(),
      settledRuns: store.settledRuns(),
      programData: result.data,
      artifacts,
      ...('failure' in result
        ? {
            failure: {
              ...result.failure,
              code: result.failure.code ?? ErrorCodes.InternalUnhandled,
            },
          }
        : {}),
    };
  }
  if (!credentials)
    return fail(`Credentials are required to run ${programId}.`);
  if (signal.aborted) return cancelled();

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
    try {
      approval.granted = await options.awaitAiApproval({ programId, signal });
    } catch (error) {
      if (signal.aborted) return cancelled();
      return fail(error instanceof Error ? error.message : String(error));
    }
    if (signal.aborted) return cancelled();
    if (!approval.granted) return abort('AI processing approval declined.');
  }

  let frameworkContext = input.frameworkContext ?? {};
  const postAuthGates = program.postAuthGates ?? [];
  if (postAuthGates.length > 0 && options.workflow) {
    try {
      const decision = await askWorkflow(
        options.workflow,
        {
          kind: 'post-auth',
          programId,
          gates: postAuthGates.map((id) => ({ id })),
        },
        signal,
      );
      const patch = decision.frameworkContext ?? {};
      for (const [key, value] of Object.entries(patch)) {
        store.setFrameworkContext(key, value);
      }
      frameworkContext = { ...frameworkContext, ...patch };
    } catch (error) {
      if (signal.aborted) return cancelled();
      return fail(error instanceof Error ? error.message : String(error));
    }
    if (signal.aborted) return cancelled();
  }

  if (program.strategy === 'self-driving') {
    const composition = input.composition ?? {};
    const workflow = options.workflow;
    const confirm = async (
      connector: ProgramWorkflowConnector,
      id: 'self-driving-handoff' | 'self-driving-github',
    ): Promise<boolean> => {
      const decision = await askWorkflow(
        connector,
        { kind: 'confirm', programId, id, installDir: input.installDir },
        signal,
      );
      return decision.confirmed;
    };
    try {
      for (const composed of program.composedRuns ?? []) {
        // A null answer means the host ran the child itself.
        const childInput = workflow
          ? (
              await askWorkflow(
                workflow,
                {
                  kind: 'child-run',
                  programId,
                  stepId: composed.stepId,
                  runProgramId: composed.runProgramId,
                  installDir: input.installDir,
                },
                signal,
              )
            ).input
          : composition.integration;
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
        if (workflow) {
          if (!(await confirm(workflow, 'self-driving-handoff'))) {
            return abort('Self-driving handoff declined.');
          }
        } else if (composition.handoffConfirmed !== true) {
          return abort('Self-driving handoff was not confirmed.');
        }
      }
      if (workflow) {
        if (!(await confirm(workflow, 'self-driving-github'))) {
          return abort('GitHub connection declined.');
        }
      } else if (composition.githubConnected !== true) {
        return abort('GitHub connection was not confirmed.');
      }
    } catch (error) {
      if (signal.aborted) return cancelled();
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  const fileWatchers = startProgramFileWatchers(
    program,
    input.installDir,
    store,
  );
  try {
    fileWatchers.seedAuditLedger();

    let run: AgentRunDefinition | undefined | null = input.run;
    let hooks: RunHooks | undefined = input.hooks;
    let seedTasks = input.seedTasks;
    if (!run && program.strategy === 'integration') {
      if (!input.frameworkConfig || !options.integrationEffects) {
        return fail(
          'PostHog integration requires prepared framework configuration and host effects.',
        );
      }
      try {
        const resolved = await resolvePosthogIntegrationRun(
          {
            installDir: input.installDir,
            frameworkConfig: input.frameworkConfig,
            frameworkContext,
            typescript: input.typescript ?? false,
            additionalFeatureQueue: input.additionalFeatureQueue,
            warehouseSources: input.warehouseSources ?? [],
            flags: { ...DEFAULT_FLAGS, ...input.flags },
            mayReportScanResults: input.mayReportScanResults ?? false,
          },
          options.integrationEffects,
        );
        run = resolved.run;
        hooks ??= resolved.hooks;
        seedTasks ??= () => resolved.seedTasks;
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    } else if (!run && program.strategy === 'self-driving') {
      const resolved = resolveSelfDrivingRun({
        installDir: input.installDir,
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
    if (signal.aborted) return cancelled();
    artifacts.reportFile = path.resolve(input.installDir, run.reportFile);

    const flags = { ...DEFAULT_FLAGS, ...input.flags };
    let flagSnapshot: WizardFlagSnapshot = {
      flags: { ...input.wizardFlags },
      payloads: { ...input.wizardFlagPayloads },
    };
    if (!input.wizardFlags && options.featureFlags) {
      try {
        flagSnapshot = await options.featureFlags();
      } catch (error) {
        if (signal.aborted) return cancelled();
        return fail(error instanceof Error ? error.message : String(error));
      }
      if (signal.aborted) return cancelled();
    }
    const wizardFlags = { ...flagSnapshot.flags };
    const wizardFlagPayloads = { ...flagSnapshot.payloads };
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

    // The agent can't swap tokens mid-run, so freshness is measured after every
    // park above, right before the agent mints.
    const posthog = await refreshCredentialsIfNeeded(credentials.posthog, {
      baseUrl: input.host?.baseUrl,
    });
    if (posthog !== credentials.posthog) {
      credentials = { ...credentials, posthog };
      store.setAuthenticated({
        credentials: posthog,
        apiProject: credentials.project,
        apiUser: credentials.apiUser,
      });
    }
    if (signal.aborted) return cancelled();
    const inferenceAuth =
      credentials.inferenceAuth ??
      createPosthogInferenceAuthProvider(posthog, programId);
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
        seedTasks,
        hooks,
      },
      {
        installDir: input.installDir,
        credentials: posthog,
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
    return {
      programId,
      outcome: result.outcome,
      runResults: store.results(),
      data: store.readData(),
      progress: store.read(),
      settledRuns: store.settledRuns(),
      artifacts,
      ...(result.outcome === RunOutcome.Success
        ? {}
        : { failure: result.failure }),
    };
  } finally {
    fileWatchers.stop();
  }
}

/** A composed child inherits the parent's value; absent on both sides stays absent. */
function mergeGiven<T extends object>(parent?: T, child?: T): T | undefined {
  return parent || child ? ({ ...parent, ...child } as T) : undefined;
}

/** Ask the connector, and reject an answer to a different kind of request. */
async function askWorkflow<R extends ProgramWorkflowRequest>(
  workflow: ProgramWorkflowConnector,
  request: R,
  signal: AbortSignal,
): Promise<Extract<ProgramWorkflowDecision, { kind: R['kind'] }>> {
  const decision = await workflow.step(request, { signal });
  if (decision.kind !== request.kind) {
    throw new Error(
      `Workflow connector answered ${decision.kind} to a ${request.kind} request`,
    );
  }
  return decision as Extract<ProgramWorkflowDecision, { kind: R['kind'] }>;
}
