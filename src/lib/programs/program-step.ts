import type { WizardSession, DiscoveredFeature } from '@lib/wizard-session';
import type { WizardReadinessResult } from '@lib/health-checks/readiness';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { Integration } from '@lib/constants';
import type { FrameworkConfig } from '@lib/framework-config';
import type { ContentBlock } from '@ui/tui/primitives/index';
import type { WizardStore } from '@ui/tui/store';

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
/**
 * Context passed to onInit callbacks — fires during store construction,
 * before bin.ts has assigned the real session.
 */
export interface StoreInitContext {
  readonly session: WizardSession;
  readonly setReadinessResult: (result: WizardReadinessResult | null) => void;
  readonly setFrameworkContext: (key: string, value: unknown) => void;
  readonly emitChange: () => void;
}

/**
 * Context passed to onReady callbacks — fires after bin.ts has assigned
 * the real session, so reading `session.installDir` returns the target
 * project. Use for async pre-program work like prerequisite detection.
 */
export interface ProgramReadyContext {
  readonly session: WizardSession;
  readonly setFrameworkContext: (key: string, value: unknown) => void;

  // Detection-specific methods — used by core-integration's detect step
  readonly setFrameworkConfig: (
    integration: Integration,
    config: FrameworkConfig,
  ) => void;
  readonly setDetectedFramework: (label: string) => void;
  readonly setUnsupportedVersion: (info: {
    current: string;
    minimum: string;
    docsUrl: string;
  }) => void;
  readonly addDiscoveredFeature: (feature: DiscoveredFeature) => void;
  readonly setDetectionComplete: () => void;
}

export interface ProgramStep {
  /** Unique identifier for this step */
  id: string;

  /** Human-readable label for progress display */
  label: string;

  /**
   * TUI screen this step owns, if any.
   * Matches the ScreenId enum values (e.g. 'intro', 'run', 'outro').
   */
  screenId?: string;

  /**
   * Whether this step should be visible in the current program.
   * If omitted, the step is always visible.
   */
  show?: (session: WizardSession) => boolean;

  /**
   * Exit condition for the screen. Router advances when true.
   * Defaults to `gate` if unset.
   */
  isComplete?: (session: WizardSession) => boolean;

  /**
   * Define a gate if your screen needs to await user interactions.
   * bin.ts can `await store.getGate(stepId)` to pause until the
   * predicate becomes true.
   */
  gate?: (session: WizardSession) => boolean;

  /**
   * Called once during store construction, with the default session.
   * Use for session-independent fire-and-forget work that should start
   * as early as possible (e.g. health check kicked off while the user
   * is still reading the intro screen).
   */
  onInit?: (ctx: StoreInitContext) => void;

  /**
   * Called once after bin.ts has assigned the real session to the store,
   * before any gate is awaited. Awaited in sequence with other steps'
   * onReady callbacks. Use for session-dependent pre-program work like
   * scanning the installDir for prerequisites. May be sync or async.
   */
  onReady?: (ctx: ProgramReadyContext) => void | Promise<void>;
}

/**
 * Uniform configuration for a wizard program.
 *
 * Each program directory exports one of these. The system uses it
 * for CLI registration, sequence/step wiring, and skill bootstrap.
 */
export interface ProgramConfig {
  /** CLI command name (e.g. 'revenue'). Omit for the default program. */
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
  /** The ordered step list */
  steps: ProgramStep[];
  /** Agent run config. Static object or async function for dynamic config. */
  run?: ProgramRun | ((session: WizardSession) => Promise<ProgramRun>);
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
   * Path (relative to installDir) of the report file the program writes.
   * Mirrors `run.reportFile` but lifted to the top level so UI screens can
   * read it synchronously without resolving a deferred `run` function.
   */
  reportFile?: string;
  /**
   * LearnCard deck rendered in the shared `RunScreen` while the agent
   * runs. Lives at `<program>/content/index.tsx` by convention.
   * Programs that ship a custom RunScreen variant (audit, audit-3000)
   * or skip the run step (posthog-doctor) leave this unset.
   */
  getContentBlocks?: (store?: WizardStore) => ContentBlock[];
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
}

/**
 * Project program steps into the narrower Screen shape the router consumes.
 *
 * Two things happen here:
 *   1. Headless steps (no `screenId`) are filtered out. The router walks
 *      visible screens; gate-only steps like `detect` are store concerns.
 *   2. The step is narrowed to just { id, show, isComplete } — the
 *      router has no business touching gate, onInit, or label.
 *
 * This intentional separation keeps the router focused on one question:
 * "Which screen should be rendered right now?"
 */
export function createProgramSequence(steps: ProgramStep[]): Array<{
  id: string;
  show?: (session: WizardSession) => boolean;
  isComplete?: (session: WizardSession) => boolean;
}> {
  const entries = steps
    .filter((step) => step.screenId != null)
    .map((step) => ({
      id: step.screenId!,
      show: step.show,
      // `isComplete` defaults to `gate` — for most steps they're the same
      // predicate (e.g. intro: setupConfirmed unblocks bin.ts AND finishes
      // the screen). Only override when the two conditions diverge.
      isComplete: step.isComplete ?? step.gate,
    }));

  // Every program ends with the exit screen.
  entries.push({ id: 'exit', show: undefined, isComplete: undefined });

  return entries;
}
