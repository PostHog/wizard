import type { WizardSession } from '../session/wizard-session.js';
import type {
  FlowStep,
  StoreInitContext,
  ProgramReadyContext,
} from '../state/flow.js';

export type { StoreInitContext, ProgramReadyContext };
import type { ProgramRunConfig } from '../agent-protocol/program-run.js';
// Type-only — erased at compile time, so no runtime cycle with the
// registry that imports `ProgramConfig` back from this module.
import type { ProgramId } from './program-registry.js';

/**
 * A program step is the primary unit of the wizard's execution model.
 *
 * It can own:
 * - a screen in the TUI (optional — some steps are headless)
 * - agent work via a program reference (optional — some steps are UI-only)
 * - completion and visibility predicates
 *
 * The PostHog integration program is one ordered list of steps.
 * Other programs (e.g. revenue analytics) register a different step list.
 */
export interface ProgramStep extends FlowStep {
  /**
   * For a run step (`screenId: 'run'`): the program whose agent this step runs,
   * composed into the host program's step list (self-driving runs the
   * integration's agent before its own). The runner executes it in the step's
   * `targetDir` after `onRunPrep`. Omit to run the host program's own agent.
   */
  run?: { programId: ProgramId };

  /**
   * For a run step: prepare a derived session before its agent runs — e.g.
   * gather framework context for the chosen project. The session it receives is
   * the run's own, so writes don't leak into later runs.
   */
  onRunPrep?: (session: WizardSession) => Promise<void>;

  /**
   * For a run step: the working directory its agent runs in, resolved from the
   * session (e.g. self-driving's integration runs in the picked monorepo
   * sub-app, not the repo root). The runner scopes a derived session to this
   * dir for that run only. Defaults to `session.installDir`.
   */
  targetDir?: (session: WizardSession) => string;
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
export interface ProgramConfig extends ProgramRunConfig {
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
  /** The ordered step list */
  steps: ProgramStep[];
  /**
   * CI-mode pre-run strategy. When set, runWizardCI awaits this after building
   * the ci:true session and before the agent runs, instead of walking step
   * onReady hooks. Use for headless prerequisite work (e.g. framework
   * detection) that the TUI performs via step onReady callbacks.
   */
  ciPreRun?: (session: WizardSession) => Promise<void>;
  /** Prerequisites: other program ids that must have run first */
  requires?: string[];
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
   * Declares this program's place in the wizard CLI surface. See
   * `ProgramCliSurface` for semantics.
   */
  cli?: ProgramCliSurface;
}
