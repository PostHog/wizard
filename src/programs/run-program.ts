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
import type { FrameworkConfig } from './framework-config';
import type { DetectedSource } from './warehouse-sources/types';
import type {
  CredentialsProvider,
  ResolvedProgramCredentials,
} from './credentials';
import { getProgramConfig } from './program-registry';
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
  type ProgramProgress,
  type ProgramStoreProjection,
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
  frameworkConfig?: FrameworkConfig;
  frameworkContext?: Record<string, unknown>;
  warehouseSources?: readonly DetectedSource[];
  detectedTools?: readonly DetectedSource[];
  mayReportScanResults?: boolean;
}

export interface ProgramOptions {
  credentials?: CredentialsProvider;
  interaction?: AgentInteraction;
  onProgress?: (progress: ProgramProgress) => void;
  mcp?: NoAgentMcpPort;
  workflow?: NoAgentProgramOptions['workflow'];
  integrationEffects?: PosthogIntegrationRunEffects;
}

export interface ProgramRunOutcome {
  programId: string;
  outcome: RunOutcome;
  runResults: RunResult[];
  data: ProgramStoreProjection;
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
  const program = getProgramConfig(programId);
  const artifacts: ProgramRunOutcome['artifacts'] = {};

  const fail = (message: string): ProgramRunOutcome => ({
    programId,
    outcome: RunOutcome.Failed,
    runResults: [],
    data: store.read(),
    artifacts,
    failure: { message },
  });

  if (!program) return fail(`Unknown program: ${programId}`);

  let credentials = input.credentials;
  if (!credentials && options.credentials) {
    try {
      credentials = await options.credentials.resolve(programId);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
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
      data: store.read(),
      programData: result.data,
      artifacts,
      ...('failure' in result ? { failure: result.failure } : {}),
    };
  }
  if (!credentials)
    return fail(`Credentials are required to run ${programId}.`);

  let run: AgentRunDefinition | undefined | null = input.run;
  let hooks: RunHooks | undefined;
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
      hooks = resolved.hooks;
      seedTasks ??= () => resolved.seedTasks;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  } else if (!run && programId === 'self-driving') {
    const resolved = resolveSelfDrivingRun({
      installDir: input.installDir,
      detectedTools: input.detectedTools ?? [],
    });
    run = resolved.run;
    hooks = resolved.hooks;
  }
  run ??=
    typeof program.run === 'object'
      ? program.run
      : resolveProgramRunDefinition(programId, input);
  if (!run) {
    return fail(
      `Program ${programId} needs a data-only run definition before it can run without a TUI session.`,
    );
  }
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
  captureSwitchboardDecision(switchboard, binding);
  const wizardMetadata = {
    ...input.wizardMetadata,
    SEQUENCE: binding.sequence,
    HARNESS: binding.harness,
  };
  const runId = input.runId ?? randomUUID();
  const adapter = store.beginRun({ runId }, options.onProgress);

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
    },
  );
  adapter.finish(result);
  return {
    programId,
    outcome: result.outcome,
    runResults: store.results(),
    data: store.read(),
    artifacts,
    ...(result.outcome === RunOutcome.Success
      ? {}
      : { failure: result.failure }),
  };
}
