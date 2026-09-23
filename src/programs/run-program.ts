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
import type { Integration } from '@shared/constants';
import { classifyRunFailure, ErrorCodes, type ErrorCode } from '@shared/errors';
import { captureRunSkillCleanup } from '@shared/skill-run-cleanup';
import { logToFile } from '@utils/debug';
import type { FrameworkConfig } from './framework-config';
import type { DetectedSource } from './warehouse-sources/types';
import type {
  CredentialsProvider,
  ResolvedProgramCredentials,
} from './credentials';
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
import {
  resolveProgramRunDefinition,
  type ProgramRunDefinitionInput,
} from './resolve-run-definition';
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

export interface ProgramInput extends ProgramRunDefinitionInput {
  installDir: string;
  /** Run-scoped credentials, or provide options.credentials instead. */
  credentials?: ResolvedProgramCredentials;
  /** Stable attribution supplied by a host. Generated when absent. */
  runId?: string;
  /** Data-only override for a program whose legacy recipe still takes a session. */
  run?: AgentRunDefinition;
  binding?: RunConfig['binding'];
  composed?: boolean;
  skillId?: string;
  integration?: Integration | null;
  frameworkDocsUrl?: string;
  flags?: Partial<RunInput['flags']>;
  mcp?: { features?: string[]; apiKey?: string };
  host?: RunInput['host'];
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
  /** Prepared child integration and gate decisions for a composed run. */
  composition?: {
    integration?: ProgramInput;
    handoffConfirmed?: boolean;
    githubConnected?: boolean;
  };
}

export interface ProgramWorkflowConnector {
  confirmStep(request: {
    programId: 'self-driving';
    stepId: 'self-driving-handoff' | 'self-driving-github';
    installDir: string;
  }): Promise<boolean>;
}

export interface ProgramOptions {
  credentials?: CredentialsProvider;
  interaction?: AgentInteraction;
  onProgress?: (progress: ProgramProgress) => void;
  mcp?: NoAgentMcpPort;
  workflow?: NoAgentProgramOptions['workflow'];
  integrationEffects?: PosthogIntegrationRunEffects;
  compositionWorkflow?: ProgramWorkflowConnector;
  /** Wait for the host's AI-processing approval gate when org approval is absent. */
  awaitAiApproval?: (context: { programId: string }) => Promise<boolean>;
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

const NO_AGENT_PROGRAMS = new Set([
  'posthog-doctor',
  'mcp-add',
  'mcp-remove',
  'mcp-tutorial',
  'slack',
]);

/** Run a registered program from explicit inputs, with invocation-owned state. */
export async function runProgram(
  programId: string,
  input: ProgramInput,
  options: ProgramOptions = {},
): Promise<ProgramRunOutcome> {
  const store = new ProgramStore();
  const installDirs = new Set([
    input.installDir,
    ...(input.composition?.integration
      ? [input.composition.integration.installDir]
      : []),
  ]);
  const cleanups = [...installDirs].map(captureRunSkillCleanup);
  const cleanFailedInvocation = () => {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        logToFile('[programs] failed-run skill cleanup error:', error);
      }
    }
  };
  try {
    const result = await runProgramWithStore(
      programId,
      input,
      options,
      store,
      undefined,
      { granted: false },
    );
    if (result.outcome !== RunOutcome.Success) cleanFailedInvocation();
    return result;
  } catch (error) {
    cleanFailedInvocation();
    throw error;
  }
}

async function runProgramWithStore(
  programId: string,
  input: ProgramInput,
  options: ProgramOptions,
  store: ProgramStore,
  stepId?: string,
  approval: { granted: boolean } = { granted: false },
): Promise<ProgramRunOutcome> {
  const program = getRuntimeProgramConfig(programId);
  const artifacts: ProgramRunOutcome['artifacts'] = {};
  const runId = input.runId ?? randomUUID();

  const fail = (
    message: string,
    code: ErrorCode = ErrorCodes.InternalUnhandled,
  ): ProgramRunOutcome => ({
    programId,
    outcome: RunOutcome.Failed,
    runResults: store.results(),
    data: store.readData(),
    progress: store.read(),
    settledRuns: store.settledRuns(),
    artifacts,
    failure: { code, message },
  });
  // A thrown error keeps the code it was decided with.
  const failFrom = (error: unknown): ProgramRunOutcome => {
    const failure = classifyRunFailure(error);
    return fail(failure.message, failure.code);
  };
  const abort = (message: string): ProgramRunOutcome => ({
    ...fail(message, ErrorCodes.AgentAbort),
    outcome: RunOutcome.Aborted,
  });
  const cancelled = (): ProgramRunOutcome => ({
    ...abort('Run cancelled by host.'),
    failure: { code: ErrorCodes.AgentAbort, message: 'Run cancelled by host.' },
  });

  if (options.signal?.aborted) return cancelled();

  if (!program)
    return fail(`Unknown program: ${programId}`, ErrorCodes.CliBadArgs);

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
      credentials = await options.credentials.resolve(programId);
    } catch (error) {
      return failFrom(error);
    }
  }
  if (credentials) {
    store.setAuthenticated({
      credentials: credentials.posthog,
      apiProject: credentials.project,
      apiUser: credentials.apiUser,
    });
  }
  if (NO_AGENT_PROGRAMS.has(programId)) {
    const result = await runNoAgentProgram(
      programId,
      {
        installDir: input.installDir,
        credentials: credentials?.posthog,
        mcp: { ...input.mcp, local: input.flags?.localMcp },
      },
      { mcp: options.mcp, workflow: options.workflow },
    );
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
              code: ErrorCodes.InternalUnhandled,
              ...result.failure,
            },
          }
        : {}),
    };
  }
  if (!credentials)
    return fail(
      `Credentials are required to run ${programId}.`,
      ErrorCodes.ArgsMissingApiKey,
    );
  if (options.signal?.aborted) return cancelled();

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
        ErrorCodes.CliInteractiveRequired,
      );
    }
    try {
      approval.granted = await options.awaitAiApproval({ programId });
    } catch (error) {
      return failFrom(error);
    }
    if (!approval.granted) return abort('AI processing approval declined.');
  }

  if (programId === 'self-driving') {
    try {
      const composition = input.composition ?? {};
      if (composition.integration) {
        store.setComposition({ parentProgramId: programId });
        const childInput = composition.integration;
        const childResult = await runProgramWithStore(
          'posthog-integration',
          {
            ...childInput,
            credentials: childInput.credentials ?? credentials,
            composed: true,
            runId: childInput.runId ?? `${runId}:integrate-run`,
            flags: { ...input.flags, ...childInput.flags },
            wizardFlags: { ...input.wizardFlags, ...childInput.wizardFlags },
            wizardFlagPayloads: {
              ...input.wizardFlagPayloads,
              ...childInput.wizardFlagPayloads,
            },
          },
          options,
          store,
          'integrate-run',
          approval,
        );
        if (childResult.outcome !== RunOutcome.Success) {
          return { ...childResult, programId };
        }
        store.markProgramCompleted('integrate-run');
        if (options.compositionWorkflow) {
          const continueAfterHandoff =
            await options.compositionWorkflow.confirmStep({
              programId: 'self-driving',
              stepId: 'self-driving-handoff',
              installDir: input.installDir,
            });
          if (!continueAfterHandoff)
            return abort('Self-driving handoff declined.');
        } else if (composition.handoffConfirmed !== true) {
          return abort('Self-driving handoff was not confirmed.');
        }
      }
      if (options.compositionWorkflow) {
        const githubConnected = await options.compositionWorkflow.confirmStep({
          programId: 'self-driving',
          stepId: 'self-driving-github',
          installDir: input.installDir,
        });
        if (!githubConnected) return abort('GitHub connection declined.');
      } else if (composition.githubConnected !== true) {
        return abort('GitHub connection was not confirmed.');
      }
    } catch (error) {
      return failFrom(error);
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
    if (!run && programId === 'posthog-integration') {
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
            frameworkContext: input.frameworkContext ?? {},
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
        return failFrom(error);
      }
    } else if (!run && programId === 'self-driving') {
      const resolved = resolveSelfDrivingRun({
        installDir: input.installDir,
        detectedTools: input.detectedTools ?? [],
      });
      run = resolved.run;
      hooks ??= resolved.hooks;
    }
    run ??=
      typeof program.run === 'object'
        ? program.run
        : resolveProgramRunDefinition(programId, input);
    if (!run) {
      return fail(
        `Program ${programId} needs a data-only run definition before it can run without a TUI session.`,
        ErrorCodes.CliInteractiveRequired,
      );
    }
    if (options.signal?.aborted) return cancelled();
    artifacts.reportFile = path.resolve(input.installDir, run.reportFile);

    const flags = { ...DEFAULT_FLAGS, ...input.flags };
    const wizardFlags = { ...input.wizardFlags };
    const wizardFlagPayloads = { ...input.wizardFlagPayloads };
    const switchboard = {
      program: programId,
      composed: input.composed ?? false,
      flags: wizardFlags,
      flagPayloads: wizardFlagPayloads,
    };
    const binding = input.binding ?? resolveProgramBinding(switchboard);
    if (!input.binding) captureSwitchboardDecision(switchboard, binding);
    const wizardMetadata = {
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
        credentials: credentials.posthog,
        inferenceAuth: credentials.inferenceAuth,
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
