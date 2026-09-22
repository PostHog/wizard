/**
 * The agent's run contracts.
 *
 * `runAgent(config, input, options)` takes resolved execution data and an
 * invocation snapshot, reports through `options.onProgress`, asks through
 * `options.interaction`, and returns a `RunResult`. Nothing here names a UI,
 * a store, a session or a program registry: the caller resolves those and
 * hands over plain data. `src/lib/programs/run-agent-legacy.ts` is the caller
 * that rebuilds today's session-driven behavior on top of this contract.
 */

import type { WizardSession } from '@lib/wizard-session';
import type { AdditionalFeature } from '@lib/constants';
import type { CloudRegion } from '@utils/types';
import type { Credentials } from '@lib/api';
import type { OutroData, TaskNotice } from '@lib/agent/progress';
import type { PromptContext } from '@lib/agent/agent-prompt';
import type { PackageManagerDetector } from '@lib/detection/package-manager';
import type { ApiProject, ApiUser } from '@lib/api';
import type { Harness, Integration, Sequence } from '@lib/constants';
import type { ErrorCode } from '@lib/errors';
import type { LLMProvider } from '@posthog/warlock';
import type { AgentInteraction, ProgressEmitter } from '@lib/agent/progress';
import type { EffortLevel } from '../switchboard/models';
import type { SwitchboardCtx } from '../switchboard';

export type { PromptContext, Credentials };

/**
 * A known `[ABORT] <reason>` case. First matching entry is rendered on
 * the error outro; unmatched aborts use a generic fallback.
 */
export interface AbortCase {
  match: RegExp;
  message: string;
  body: string;
  docsUrl?: string;
  errorCode?: ErrorCode;
}

/**
 * Unified agent run configuration.
 *
 * Every program provides one of these — either as a static object
 * or via a function that builds one from the session. The runner
 * assembles the final prompt from `prompt` + `skillId`.
 *
 * The three session-taking hooks at the end are the caller's: the agent never
 * calls them. `run-agent-legacy.ts` binds them and hands the agent
 * `RunConfig.hooks` instead.
 */
export interface ProgramRun {
  /** Analytics label (e.g. 'revenue-analytics-setup', 'nextjs') */
  integrationLabel: string;
  /** Skill ID to pre-install. Omit for agent-driven skill discovery. */
  skillId?: string;
  /** Additional program-specific prompt instructions. Appended after the default project prompt. */
  customPrompt?: (ctx: PromptContext) => string;
  /** Additional MCP servers (e.g. Svelte MCP) */
  additionalMcpServers?: Record<string, { url: string }>;
  /** Package manager detector. Defaults to detectNodePackageManagers. */
  detectPackageManager?: PackageManagerDetector;
  spinnerMessage: string;
  successMessage: string;
  estimatedDurationMinutes: number;
  reportFile: string;
  docsUrl: string;
  errorMessage?: string;
  additionalFeatureQueue?: readonly AdditionalFeature[];
  /** Known `[ABORT] <reason>` cases this program can render. */
  abortCases?: AbortCase[];
  /** Runs after agent completes, before outro (e.g. env var upload). */
  postRun?: (session: WizardSession, credentials: Credentials) => Promise<void>;
  /** Custom outro data. Omit for default built from successMessage/reportFile/docsUrl. */
  buildOutroData?: (
    session: WizardSession,
    credentials: Credentials,
  ) => WizardSession['outroData'];
  /**
   * Outro bullets for a sequence that composes its own outro data.
   *
   * `buildOutroData` is the linear sequence's seam: it hands the program the
   * whole outro. The orchestrated sequence cannot, because its message is the
   * drain's result — how many steps ran, what was skipped, which conflict the
   * review step left. So a program with next steps to offer had nowhere to put
   * them there, and the integration's data-source links were built and then
   * dropped on every orchestrated run. This hook keeps the message with the
   * sequence and the bullets with the program.
   *
   * `completedSeededTypes` names the runner-seeded task types that finished
   * successfully, so a program can leave out a step its own seeded task
   * already did — the sequence stays ignorant of what any type means.
   */
  buildOutroNextSteps?: (
    session: WizardSession,
    credentials: Credentials,
    completedSeededTypes: readonly string[],
  ) => { heading: string; items: string[] } | undefined;
  /**
   * Per-run cap on `wizard_ask` invocations. Defaults to 10. The 4th call
   * always returns a "batch your questions" error regardless of the cap.
   */
  maxQuestions?: number;
  /**
   * Opt this program's `wizard_ask` overlays into rich link rendering:
   * standalone URLs in prompt text become OSC 8 hyperlinks and a lone URL is
   * copied to the clipboard, so a long URL can't be broken by the overlay's
   * line wrapping. Defaults to false — leave off for flows we don't own.
   */
  richLinks?: boolean;
  /**
   * Per-question `wizard_ask` timeout in milliseconds. Defaults to
   * DEFAULT_ASK_TIMEOUT_MS (5 minutes). Raise it for programs whose
   * questions send the user off to do slow work (run a build, create a
   * key in the browser) before they can answer.
   */
  askTimeoutMs?: number;
  /**
   * Emit a `wizard: step` analytics event on each agent task-list transition
   * (in_progress / completed) so this program can build a step-level drop-off
   * funnel — including silent steps that ask the user nothing. The step name is
   * whatever the agent set on the task. Defaults to off, so no other program's
   * analytics change; opt in per program.
   */
  trackStepProgress?: boolean;
  /**
   * Map an agent-authored step label to a stable key, shipped on `wizard: step` as `step_key`.
   * The runner knows nothing about any program's steps, so a program that wants its funnel to
   * survive the agent rewording a task supplies the mapping itself. Omit it and only the label
   * ships, as before.
   */
  resolveStepKey?: (stepName: string | undefined) => string | undefined;
}

/** A task the caller queues itself before the orchestrator's planner runs. */
export interface SeedTaskEntry {
  type: string;
  label?: string;
  inputs?: Record<string, unknown>;
  /** Shown before the run starts, letting the user decline the task. */
  notice?: TaskNotice;
}

/**
 * Completion hooks the caller binds for the agent. Each receives the run's
 * resolved credentials, exactly what the linear and orchestrator sequences
 * passed alongside the session before.
 */
export interface RunHooks {
  /** Runs after the agent completes, before the outro (linear only). */
  postRun?: (credentials: Credentials) => Promise<void>;
  /** Custom outro data (linear only). Omit for the default outro. */
  buildOutroData?: (credentials: Credentials) => OutroData | undefined;
  /** Outro bullets for the orchestrated sequence. */
  buildOutroNextSteps?: (
    credentials: Credentials,
    completedSeededTypes: readonly string[],
  ) => { heading: string; items: string[] } | undefined;
}

/** The run-level routing decision the caller made. */
export interface ResolvedBinding {
  sequence: Sequence;
  harness: Harness;
  /** Gateway model id. */
  model: string;
  /** Reasoning-effort override. Absent → the model's table default. */
  thinkingLevel?: EffortLevel;
}

/**
 * Resolved execution data for one agent run. The caller has already decided
 * which program this is, how it is routed and which flags apply; the agent
 * treats every label as opaque.
 */
export interface RunConfig {
  /** Program id: gateway spend pin, analytics label, commandments axis. */
  programId: string;
  /** The program's run definition. Its session-taking hooks are the caller's, see `hooks`. */
  run: ProgramRun;
  /** A composed sub-run leaves the terminal outro to its host. */
  composed: boolean;
  /** Run-level sequence, harness and model. */
  binding: ResolvedBinding;
  /**
   * The inputs the run-level binding was resolved from. The orchestrator
   * re-resolves the harness per task role from these; nothing else reads them.
   */
  switchboard: SwitchboardCtx;
  /** Primary skills origin (context-mill dev or GitHub Releases). */
  skillsBaseUrl: string;
  /** Feature flag key → variant, evaluated before the run. */
  wizardFlags: Record<string, string>;
  /** Flag payloads from the same snapshot. */
  wizardFlagPayloads: Record<string, unknown>;
  /** Gateway trace tags for this run, already stamped with sequence and harness. */
  wizardMetadata: Record<string, string>;
  /** Extra tools added on top of BASE_ALLOWED_TOOLS for this run. */
  allowedTools?: readonly string[];
  /** Tools removed from BASE_ALLOWED_TOOLS for this run. */
  disallowedTools?: readonly string[];
  /** Context-mill flow the orchestrator loads. Defaults to `programId`. */
  agentFlow?: string;
  /** Tasks to queue before the orchestrator's planner runs. */
  seedTasks?: () => SeedTaskEntry[];
  /** Completion hooks, bound by the caller. */
  hooks?: RunHooks;
}

/** Invocation flags the agent reads. */
export interface RunFlags {
  ci: boolean;
  signup: boolean;
  debug: boolean;
  /** Harness-only: keep the ask bridge in a `ci` run that has an answerer. */
  e2eAsk: boolean;
  localMcp: boolean;
  captureAio: boolean;
  benchmark: boolean;
  yaraReport: boolean;
}

/**
 * The invocation snapshot for one agent run. Taken once by the caller; the
 * agent never refreshes these from a higher layer.
 */
export interface RunInput {
  installDir: string;
  /** Resolved credentials, including the host family and its MCP url. */
  credentials: Credentials;
  /** Project payload resolved at authentication, for prompt context. */
  project: ApiProject | null;
  /** User payload resolved at authentication, for the AI opt-in prompt line. */
  apiUser: ApiUser | null;
  /** The skill this run is for: the run's skill id, else its integration label. */
  skillId?: string;
  /** Detected framework, when the caller has one. */
  integration?: Integration | null;
  /** Docs page for the detected framework, for the orchestrator's preflight message. */
  frameworkDocsUrl?: string;
  flags: RunFlags;
  /** Where PostHog is, as the CLI was told. */
  host: {
    baseUrl?: string;
    region?: CloudRegion;
    email?: string;
    /** `--project-id`, for the auth-error classifier. */
    projectId?: number;
    /** `--api-key`, for the auth-error classifier. */
    apiKey?: string;
  };
}

/**
 * The values `prepareRun` resolves from `RunConfig` + `RunInput` and hands to
 * both sequences: the gateway mint and the scan-triage classifier built on it.
 */
export interface BootstrapResult {
  skillsBaseUrl: string;
  /** Resolved credentials (incl. the host family and its MCP url). */
  credentials: Credentials;
  /** Program this run is, and the node its gateway spend pins to. */
  programId: string;
  wizardFlags: Record<string, string>;
  /** Flag payloads from the same snapshot (e.g. the self-driving pi `{model, effort?, harness?, sequence?}`). */
  wizardFlagPayloads: Record<string, unknown>;
  wizardMetadata: Record<string, string>;
  /** Full project payload, for project-level prompt context (opt-ins). */
  project: ApiProject | null;
  /** Scan-triage classifier on this run's harness. Undefined → skill scans fail closed. */
  triageProvider: LLMProvider | undefined;
}

/**
 * A decided failure. The same fields `wizardAbort` takes, so the legacy
 * adapter passes it through untouched and the exit sequence, codes and
 * messages stay exactly what they were.
 */
export interface AgentFailure {
  message?: string;
  /** Structured error data. Renders via `outroError` instead of `outro`. */
  outroData?: OutroData;
  error?: Error;
  exitCode?: number;
  code?: ErrorCode;
  detail?: Record<string, unknown>;
}

export enum RunOutcome {
  Success = 'success',
  Aborted = 'aborted',
  Failed = 'failed',
  Crashed = 'crashed',
}

/** Totals of every `usage` event the run emitted. */
export interface TokenUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** What the agent reported, accumulated independently of any observer. */
export interface RunSnapshot {
  tasks: import('@lib/agent/progress').TaskSnapshot[];
  statusMessages: string[];
  stage?: string;
  usage: TokenUsageTotals;
  finalCostUsd?: number;
  dashboardUrl?: string;
  notebookUrl?: string;
}

/** A sequence decides an outcome; the dispatcher owns its snapshot. */
export type SequenceResult =
  | { outcome: RunOutcome.Success; outro?: OutroData; failure?: never }
  | {
      outcome: RunOutcome.Aborted | RunOutcome.Failed;
      failure: AgentFailure;
      outro?: never;
    };

/** Every non-success result carries a failure; crashes preserve the original error. */
export type RunResult = (
  | SequenceResult
  | {
      outcome: RunOutcome.Crashed;
      failure: AgentFailure & { error: Error };
      outro?: never;
    }
) & {
  /** The skill this run installed or was for. */
  skillId?: string;
  snapshot: RunSnapshot;
};

export interface RunAgentOptions {
  /** Receives every progress event in emission order. Never awaited. */
  onProgress?: (event: import('@lib/agent/progress').AgentProgress) => void;
  /** Answers the agent's questions. Absent → no ask bridge, notices declined. */
  interaction?: AgentInteraction;
}

/** What a sequence receives: the contracts plus the prepared run. */
export interface SequenceContext {
  config: RunConfig;
  input: RunInput;
  boot: BootstrapResult;
  emit: ProgressEmitter;
  interaction: AgentInteraction | undefined;
}
