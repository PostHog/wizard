import type { DiscoveredFeature } from '@shared/scan-consent';
import type { TaskNotice } from '@agent/types';
import type { ProgramSession } from './program-session';
import type { ProgramRun } from '@programs/program-run';
import type { Integration } from '@shared/constants';
import type { FrameworkConfig } from '@programs/framework-config';
// Type-only — erased at compile time, so no runtime cycle with the
// registry that imports `ProgramConfig` back from this module.
import type { ProgramId } from './program-registry.js';
import type { ProgramCiHost, ProgramRunHost } from './host-capabilities.js';

/**
 * Context passed to onReady callbacks — fires after bin.ts has assigned
 * the real session, so reading `session.installDir` returns the target
 * project. Use for async pre-program work like prerequisite detection.
 */
export interface ProgramReadyContext {
  readonly session: ProgramSession;
  readonly setFrameworkContext: (key: string, value: unknown) => void;

  // Detection-specific methods — used by core-integration's detect step
  readonly setFrameworkConfig: (
    integration: Integration,
    config: FrameworkConfig,
  ) => void;
  readonly setDetectedFramework: (label: string) => void;
  readonly setSkillId: (skillId: string | null) => void;
  readonly setUnsupportedVersion: (info: {
    current: string;
    minimum: string;
    docsUrl: string;
  }) => void;
  readonly addDiscoveredFeature: (feature: DiscoveredFeature) => void;
  readonly setDetectionComplete: () => void;
  readonly setPosthogSdkDetected: (detected: boolean) => void;
}

/**
 * How one of a flow's run steps runs: which program's agent, in which
 * directory, after what preparation. Keyed by the flow step id.
 */
export interface ProgramRunStep {
  /** The child program whose agent runs. Omit to run this program's own agent. */
  runProgramId?: ProgramId;
  /**
   * Prepare a derived session before the agent runs, e.g. gather framework
   * context for the chosen project. The session is the run's own, so writes
   * don't leak into later runs.
   */
  onRunPrep?: (session: ProgramSession) => Promise<void>;
  /**
   * The directory the agent runs in (e.g. a picked monorepo sub-app). The
   * runner scopes a derived session to it for that run only. Defaults to
   * `session.installDir`.
   */
  targetDir?: (session: ProgramSession) => string;
}

/**
 * Declares a program's place in the wizard CLI surface.
 *
 * Mirrors the `cli:` block in context-mill skill configs so wizard-native
 * programs and skill-backed programs share one vocabulary. Field names
 * match `ProgramConfig.command` / `parentCommand` above, so contributors
 * only learn one set of words.
 *
 *   - `role: 'command'`  — appears as a normal wizard command.
 *   - `role: 'skill'`    — reachable only via `wizard skill <id>`.
 *   - `role: 'internal'` — hidden everywhere, only reachable via the
 *                          `--skill=<id>` dev escape hatch.
 *
 * Mapping table — declaration on the left, registered command on the right:
 *
 *   { role: 'command',                            →  wizard revenue-analytics
 *     command: 'revenue-analytics' }
 *
 *   { role: 'command',                            →  wizard audit feature-flags
 *     parentCommand: 'audit',
 *     command: 'feature-flags' }
 *
 *   { role: 'skill' }                             →  wizard skill <id>
 *
 * `cli` only configures the command shape — the verbs the user types.
 * Flags and positional args (e.g. `--since=30d`) are configured on
 * `cliOptions`, not here.
 *
 * Naming rule: commands use the full PostHog product name with hyphens
 * (`revenue-analytics`, `feature-flags`, `session-replay`), not
 * abbreviations like `revenue` or `flags`.
 */
export interface ProgramCliSurface {
  /** Where the program appears in the wizard CLI surface. */
  role: 'command' | 'skill' | 'internal';
  /**
   * The user-typed word that registers this program (e.g. `'feature-flags'`
   * in `wizard audit feature-flags`, or `'revenue-analytics'` in
   * `wizard revenue-analytics`). Required when `role` is `'command'`.
   */
  command?: string;
  /**
   * The command this program nests under (e.g. `'audit'` for
   * `wizard audit feature-flags`). Omit for flat / standalone commands.
   */
  parentCommand?: string;
}

/**
 * Uniform configuration for a wizard program.
 *
 * Each program directory exports one of these. The system uses it
 * for CLI registration, sequence/step wiring, and skill bootstrap.
 */
export interface ProgramConfig {
  /** CLI command name (e.g. 'revenue-analytics'). Omit for the default program. */
  command?: string;
  /**
   * Parent CLI command to nest this program under. When set, the program is
   * registered as `<parentCommand> <command>` instead of as a top-level
   * command. The parent must itself be a registered subcommand program. Omit
   * for top-level programs.
   */
  parentCommand?: string;
  /** CLI description shown in --help */
  description: string;
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
  /**
   * Detection before the flow: runs once after the host assigns the real
   * session, before any gate is awaited. May be sync or async.
   */
  onReady?: (ctx: ProgramReadyContext) => void | Promise<void>;
  /** Run steps that compose a child program or scope a run, keyed by step id. */
  runSteps?: Record<string, ProgramRunStep>;
  /** Agent run config. Static object or async function for dynamic config. */
  run?:
    | ProgramRun
    | ((session: ProgramSession, host: ProgramRunHost) => Promise<ProgramRun>);
  /**
   * CI-mode pre-run strategy. When set, runWizardCI awaits this after building
   * the ci:true session and before the agent runs, instead of walking step
   * onReady hooks. Use for headless prerequisite work (e.g. framework
   * detection) that the TUI performs via step onReady callbacks.
   */
  ciPreRun?: (session: ProgramSession, host: ProgramCiHost) => Promise<void>;
  /**
   * Tasks the orchestrator queues itself, before the planner runs, from what
   * the wizard detected. Their types are marked `runnerSeeded: true` in the
   * agent prompt, so the planner never sees them: whether such a task runs is
   * decided here, in code, not by a model that could invent it or forget it.
   * Return an empty list to queue none.
   */
  seedTasks?: (session: ProgramSession) => Array<{
    type: string;
    label?: string;
    inputs?: Record<string, unknown>;
    /**
     * Shown before the run starts, letting the user decline the task. The
     * program owns the words — the runner and the modal only carry them. A
     * task without one is queued silently.
     */
    notice?: TaskNotice;
  }>;
  /** Prerequisites: other program ids that must have run first */
  requires?: string[];
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
   * Subcommand-specific CLI options. Spread into yargs `.options(...)` when the
   * program's subcommand is registered. Program-specific knowledge stays in
   * the program config, not in bin.ts. Typed as `unknown` to avoid pulling a
   * yargs dependency into this module.
   */
  cliOptions?: Record<string, unknown>;
  /**
   * Translate parsed CLI argv into extra options the runner consumes. Runs
   * after yargs validation, before runWizard/runWizardCI. Use this when a flag
   * needs to derive another field (e.g. `--product=statsig` → `skillId:
   * 'migrate-statsig'`).
   */
  mapCliOptions?: (argv: Record<string, unknown>) => Record<string, unknown>;
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
   * Declares this program's place in the wizard CLI surface. See
   * `ProgramCliSurface` for semantics.
   */
  cli?: ProgramCliSurface;
}
