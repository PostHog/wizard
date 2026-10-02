import type { ProgramSession } from './program-session';
import type { DiscoveredFeature } from '@shared/discovered-feature';
import type { ProgramBinding, TaskNotice } from '@agent/types';
import type { ProgramRun } from './program-run';
import type { Integration } from '@shared/constants';
import type { FrameworkConfig } from './framework-config';
import type { CiRunnerContext, RunnerContext } from './runner-context.js';

/**
 * Context passed to onReady callbacks — fires after the host has assigned
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
 * A run in a program's flow that is not the program's own agent run: a
 * composed sub-run of another program, or the program's run scoped to a
 * picked project. Keyed in `ProgramConfig.runSteps` by the flow step id.
 */
export interface ProgramRunStep {
  /**
   * Run this program's agent instead of the host's, composed: the host keeps
   * its outro and analytics (self-driving runs posthog-integration first).
   */
  runProgramId?: ProgramId;
  /**
   * Prepare the run's own derived session once the host confirms its step, e.g.
   * gather framework context for the chosen project. Writes don't leak into
   * later runs; log lines arrive as the program's progress.
   */
  onRunPrep?: (
    session: ProgramSession,
    log: RunnerContext['log'],
  ) => Promise<void>;
  /** The directory the run's agent works in. Defaults to `session.installDir`. */
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

/** A program's `id`. */
export type ProgramId = string;

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
  /** Sequence, harness and model the agent runs with. Omit for `DEFAULT_BINDING`. */
  binding?: ProgramBinding;
  /**
   * Content-mill flow the orchestrator loads its agent prompts + step-skills
   * from (`agents/<flow>/` and `skills/<flow>/`). Defaults to `id`; set it when
   * the content-mill flow name diverges from the program id.
   */
  agentFlow?: string;
  /**
   * Context-mill skill ID this program installs and runs. When present,
   * the host seeds `session.skillId` with this value before the TUI renders
   * so intro screens can resolve skill metadata without waiting for the
   * agent run.
   */
  skillId?: string;
  /**
   * Detection before the program starts: scan the install dir and record what
   * the intro screen and the run need. The TUI awaits it once, after the real
   * session is assigned, and runProgram runs it through detectProgram when its
   * store has no detection yet.
   */
  onReady?: (ctx: ProgramReadyContext) => void | Promise<void>;
  /** Runs in the flow other than the program's own agent run, keyed by flow step id. */
  runSteps?: Record<string, ProgramRunStep>;
  /**
   * Whether the run checks PostHog's readiness first. Defaults to `true`; the
   * TUI shows the health-check screen for these programs.
   */
  healthCheck?: boolean;
  /** Agent run config. Static object or async function for dynamic config. */
  run?:
    | ProgramRun
    | ((session: ProgramSession, runner: RunnerContext) => Promise<ProgramRun>);
  /**
   * CI-mode pre-run strategy. When set, detectProgram awaits this in place of
   * `onReady` for a ci:true session, before runProgram starts the agent. Use
   * for headless prerequisite work (e.g. framework detection) that the TUI
   * performs via step onReady callbacks.
   */
  ciPreRun?: (
    session: ProgramSession,
    runner: CiRunnerContext,
  ) => Promise<void>;
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
  /**
   * Task types this run excludes, decided from the run's wizard flags. An
   * excluded type does not exist for the run: the planner cannot enqueue it
   * and no agent boots for it. The program owns the flag→type mapping; the
   * runner only applies it.
   */
  excludedTaskTypes?: (flags: Record<string, string>) => readonly string[];
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
  /** Audit ledger to mirror into the session and delete at run end, relative to `installDir`. */
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
   * the program config, not in the CLI. Typed as `unknown` to avoid pulling a
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
  /**
   * OAuth scopes this program's login asks for on top of the base set. They
   * only widen it: the resolver in `program-registry.ts` merges them after the
   * base scopes. Every scope must stay within the wizard OAuth app's ceiling
   * (README, "OAuth app scope ceiling").
   */
  oauthScopeAdditions?: readonly string[];
}
