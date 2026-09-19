/**
 * The run contract between the store and the agent. Programs describe what to
 * run with these types; the agent executes one run and never reads program
 * steps. Both surfaces import from here.
 */

import type {
  Credentials,
  AdditionalFeature,
  WizardSession,
  TaskNotice,
} from '../session/wizard-session.js';
import type { PackageManagerDetector } from '../detection/package-manager.js';
import type { HostResolution } from '../host-resolution.js';

export type { Credentials };

/**
 * Values available to prompt builders after OAuth completes.
 */
export interface PromptContext {
  projectId: number;
  projectApiKey: string;
  host: HostResolution;
  /** Set when skillId was provided and the skill was installed successfully. */
  skillPath?: string;
  /**
   * Org-level AI consent (`is_ai_data_processing_approved`) read from the
   * `/api/users/@me/` payload at auth time. `null` = unknown (older orgs,
   * or the user fetch failed). Lets prompts pre-resolve consent state so
   * agents only ask the user when it is actually off or unknown.
   */
  orgAiDataProcessingApproved?: boolean | null;
  /**
   * Team product opt-ins from the `/api/projects/:id/` payload at auth
   * time. Project-level truth for "is this product enabled" — products
   * can be instrumented from other repos or the snippet, so repo-local
   * evidence must never rule them out. `null` field = unknown.
   */
  teamProductOptIns?: {
    sessionReplay?: boolean | null;
    exceptionAutocapture?: boolean | null;
    surveys?: boolean | null;
  } | null;
}

/**
 * A known `[ABORT] <reason>` case. First matching entry is rendered on
 * the error outro; unmatched aborts use a generic fallback.
 */
export interface AbortCase {
  match: RegExp;
  message: string;
  body: string;
  docsUrl?: string;
  errorCode?: import('../shared/errors/index.js').ErrorCode;
}

/**
 * Unified agent run configuration.
 *
 * Every program provides one of these — either as a static object
 * or via a function that builds one from the session. The runner
 * assembles the final prompt from `prompt` + `skillId`.
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

/** A task the runner queues itself, before the planner runs. */
export interface SeedTask {
  type: string;
  label?: string;
  inputs?: Record<string, unknown>;
  /**
   * Shown before the run starts, letting the user decline the task. The
   * program owns the words — the runner and the modal only carry them. A
   * task without one is queued silently.
   */
  notice?: TaskNotice;
}

/**
 * What the agent receives for one run: the fields of a program the runner
 * reads. `ProgramConfig` extends this with steps and CLI shape, which the
 * agent never sees.
 */
export interface ProgramRunConfig {
  /** Unique program id — matches the Program enum value */
  id: string;
  /**
   * Content-mill flow the orchestrator loads its agent prompts + step-skills
   * from (`agents/<flow>/` and `skills/<flow>/`). Defaults to `id`; set it when
   * the content-mill flow name diverges from the program id.
   */
  agentFlow?: string;
  /**
   * Whether this program's agent run requires third-party AI services.
   *
   * When true (the default), the wizard checks
   * `apiUser.organization.is_ai_data_processing_approved` after auth and
   * renders `AiOptInRequiredScreen` if the org has not opted in. Matches
   * Max's strict reading: only literal `true` proceeds.
   *
   * Opt out (set to `false`) for programs that don't run the agent —
   * doctor, mcp install/remove/tutorial, source-map upload. The safe
   * default is `true` so future programs gate by declaration.
   */
  requiresAi?: boolean;
  /**
   * Context-mill skill ID this program installs and runs. When present,
   * bin.ts seeds `session.skillId` with this value before the TUI renders
   * so intro screens can resolve skill metadata without waiting for the
   * agent run.
   */
  skillId?: string;
  /** Agent run config. Static object or async function for dynamic config. */
  run?: ProgramRun | ((session: WizardSession) => Promise<ProgramRun>);
  /**
   * Tasks the orchestrator queues itself, before the planner runs, from what
   * the wizard detected. Their types are marked `runnerSeeded: true` in the
   * agent prompt, so the planner never sees them: whether such a task runs is
   * decided here, in code, not by a model that could invent it or forget it.
   * Return an empty list to queue none.
   */
  seedTasks?: (session: WizardSession) => SeedTask[];
  /**
   * Path (relative to installDir) of the report file the program writes.
   * Mirrors `run.reportFile` but lifted to the top level so UI screens can
   * read it synchronously without resolving a deferred `run` function.
   */
  reportFile?: string;
  /**
   * Agent-authored event-plan artifact to mirror into the wizard session.
   * Relative to `session.installDir`. Programs that do not produce an event
   * plan leave this unset, so generic runner machinery does not inspect a
   * stale or unrelated `.posthog-events.json` file.
   */
  eventPlanFile?: string;
  /** Audit ledger to mirror into the session, relative to `installDir`. */
  auditLedgerFile?: string;
  /**
   * Channel the task stream publishes this run under, when it differs from the
   * program id. A family leaf runs on the generic skill program, so without
   * this every `wizard audit <leaf>` would report as `agent-skill`.
   */
  streamWorkflowId?: string;
  /**
   * Extra tool names added on top of BASE_ALLOWED_TOOLS for this program's
   * agent run. Use for tools that only this program needs.
   */
  allowedTools?: readonly string[];
  /**
   * Tool names removed from BASE_ALLOWED_TOOLS for this program's agent
   * run. Use to forbid a base tool — e.g. `['Agent']` to block subagent
   * dispatch in a program whose steps are explicitly single-agent.
   */
  disallowedTools?: readonly string[];
  /**
   * Gated step ids between the auth and run steps, awaited after login and
   * before the agent starts. The flow layer computes them from the steps
   * (`runConfigFor`); the agent only awaits them.
   */
  postAuthGateIds?: readonly string[];
  /**
   * True when the flow declares a health check step, so bootstrap runs the
   * service pre-flight. Computed by `runConfigFor`; other programs never
   * probe and never block.
   */
  healthCheckDeclared?: boolean;
}
