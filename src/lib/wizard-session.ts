/**
 * WizardSession — single source of truth for every decision the wizard needs.
 *
 * Populated in layers:
 *   CLI args / env vars  →  populate fields directly
 *   Auto-detection       →  framework, typescript, package manager
 *   TUI screens          →  region, framework disambiguation, etc.
 *   OAuth                →  credentials
 *
 * Business logic reads from the session. Never calls a prompt.
 */

import { POSTHOG_LOCAL_URL, resolveLocalDev } from '@shared/local-dev';
import type { Harness, Integration, Sequence } from '@shared/constants';
import type { FrameworkConfig } from '@programs/types';
import type { WizardReadinessResult } from '@shared/health-checks/readiness';
import type { SettingsConflict } from '@shared/claude-settings';
import type { ApiUser, ApiProject, Credentials } from '@shared/api';
import type { CloudRegion } from '@utils/types';
import type {
  AskAnswers,
  AskQuestion,
  OutroData,
  PendingQuestion,
  TaskNotice,
} from '@agent/types';
// Leaf module on purpose: shared analytics imports this file, so the agent
// entry would form a module cycle here.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the session becomes a TUI projection later in the refactor
import { OutroKind } from '@agent/progress';

// These shapes moved to their owners; re-exported so every session reader
// keeps its import path. `Credentials` sits with the API types, and the
// outro, question and task-notice shapes are the agent's contract.
export type { Credentials, CloudRegion };
export { OutroKind };
export type { AskAnswers, AskQuestion, OutroData, PendingQuestion, TaskNotice };

function parseProjectIdArg(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Lifecycle phase of the main work (agent run, MCP install, etc.) */
export enum RunPhase {
  /** Still gathering input (intro, setup screens) */
  Idle = 'idle',
  /** Main work is in progress */
  Running = 'running',
  /** Main work finished successfully */
  Completed = 'completed',
  /** Main work finished with an error */
  Error = 'error',
}

/** Features discovered by the feature-discovery subagent */
export enum DiscoveredFeature {
  Stripe = 'stripe',
  LLM = 'llm',
}

/** Consent to report what local detection found (see `scanConsent` below). */
export enum ScanConsent {
  Undecided = 'undecided',
  Granted = 'granted',
  Declined = 'declined',
}

/** Outcome of the MCP server installation step */
export enum McpOutcome {
  NoClients = 'no_clients',
  Skipped = 'skipped',
  Installed = 'installed',
  Failed = 'failed',
}

/**
 * PostHog dashboard URL emitted by the agent during a program run.
 * Populated via the `[DASHBOARD_URL]` text marker in agent assistant messages
 * — see `handleSDKMessage` in `agent/agent-interface.ts`. Read by programs
 * (e.g. events-audit) inside `buildOutroData` to surface a dashboard link
 * the agent actually created.
 */

export interface WizardSession {
  // From CLI args
  debug: boolean;
  installDir: string;
  ci: boolean;
  signup: boolean;
  /**
   * Harness-only escape hatch: keep the `wizard_ask` bridge wired in a `ci`
   * session so an e2e run can answer the agent's questions.
   *
   * Only the e2e TUI host sets it, from the `E2E_ASK` env var. There is no CLI
   * flag, `bin.ts` never populates it, and nothing in a published build reads
   * the env var — so a normal `--ci` run is unchanged. See `shouldDisableAsk`.
   *
   * Guarding `E2E_ASK` is not enough on its own: the CI runner spreads the
   * whole `POSTHOG_WIZARD_*` bag into `buildSession`, which would let
   * `POSTHOG_WIZARD_e2e_ask=true` set this field. `readEnvironment` drops it —
   * see `NEVER_FROM_ENV`, and keep that list in step with this comment.
   */
  e2eAsk: boolean;
  /**
   * `--local-posthog` folds into `baseUrl`, and `--local-context-mill` is read
   * from `getLocalDev()` — neither belongs here. This one stays because
   * `mcp add|remove|tutorial --local` populate it from their own flag.
   */
  localMcp: boolean;
  mcpFeatures?: string[];
  apiKey?: string;
  email?: string;
  region?: CloudRegion;
  /**
   * Explicit PostHog base URL (`--base-url`). When set, it pins every PostHog
   * origin — API host, cloud/app URL, OAuth server — and `region` is ignored.
   * The runtime equivalent of the dev-build localhost routing; lets the shipped
   * wizard target a local/self-hosted stack. Threaded into the URL helpers in
   * `@utils/urls`. Empty/unset → region-based resolution.
   */
  baseUrl?: string;
  benchmark: boolean;
  yaraReport: boolean;
  projectId?: number;
  noTelemetry: boolean;

  /**
   * `--capture-aio`: mirror every wizard LLM call as an `$ai_generation` event
   * into the authenticated project's AI Observability tab. Dev/test builds
   * only — the flag is undeclared in published builds so this stays `false`
   * there. See `src/agent/aio-capture.ts`.
   */
  captureAio: boolean;

  /** `--harness` override, read by `resolveHarness`. Wins over the runner flag. */
  harness?: Harness;
  /** `--sequence` override, read in `runProgram`. Wins over the orchestrator flag. */
  sequence?: Sequence;
  /** `--model` override (gateway id), read by `resolveHarness`. Wins over the binding's model. */
  model?: string;

  // From detection + screens
  setupConfirmed: boolean;
  /**
   * Gates reporting only; local detection runs either way. Reporting treats
   * 'undecided' as 'declined', so a path that reports before the user was
   * asked sends nothing rather than everything.
   */
  scanConsent: ScanConsent;
  /** Guards against reporting twice; consent resolves from two paths. */
  warehouseSourcesReported: boolean;
  /**
   * Guards `maybeStampAiSdkDetected` against running twice: it is called from
   * both run-wizard.ts's auth step and bootstrap.ts, since either can be the
   * first real `authenticate()` to complete depending on the program.
   */
  aiSdkStampReported: boolean;
  integration: Integration | null;
  frameworkContext: Record<string, unknown>;
  typescript: boolean;

  /** Human-readable label for the detected framework variant (e.g., "Django with Wagtail CMS") */
  detectedFrameworkLabel: string | null;

  /** PostHog found in the project's dependencies. A signal, not a verified install. */
  posthogSdkDetected: boolean;

  /** True once framework detection has run (whether it found something or not) */
  detectionComplete: boolean;

  /** Set when the detected framework version is too old for the wizard */
  unsupportedVersion: {
    current: string;
    minimum: string;
    docsUrl: string;
  } | null;

  // From OAuth
  credentials: Credentials | null;

  /**
   * `role_at_organization` from `/api/users/@me/`. Null when the upstream
   * value is missing (older accounts, fresh signups before onboarding).
   * Drives role-tailored MCP prompt suggestions on the McpSuggestedPromptsScreen.
   *
   * Mirrors `apiUser?.role_at_organization` — kept as a top-level convenience
   * because it has dedicated UI semantics (role-tailored kits) and pre-dates
   * the broader `apiUser` plumbing.
   */
  roleAtOrganization: string | null;

  /**
   * Full user payload from `/api/users/@me/` — identifiers, profile,
   * current team + organization, preferences, etc. Null until OAuth /
   * CI-key auth populates it. Schema lives in `src/shared/api.ts` and
   * passes through unknown upstream fields so downstream features can
   * read account context (plan, org name, email, etc.) without
   * re-fetching.
   */
  apiUser: ApiUser | null;

  /**
   * Project payload resolved at authentication, kept so a second agent run in
   * the same invocation (e.g. self-driving's integration phase) reuses the
   * first login wholesale instead of re-authenticating. The resolved region
   * lives on `credentials.host.region`.
   */
  apiProject: ApiProject | null;

  // Lifecycle
  runPhase: RunPhase;
  loginUrl: string | null;
  // Direct PostHog authorize URL, shown in the manual-paste modal for
  // headless/remote shells (the localhost loginUrl is unreachable there).
  authorizeUrl: string | null;

  // Feature discovery
  discoveredFeatures: DiscoveredFeature[];

  // ScreenId completion
  mcpComplete: boolean;
  mcpOutcome: McpOutcome | null;
  mcpInstalledClients: string[];
  /** Editor-owned login commands still to run (e.g. `claude mcp login posthog`), echoed at exit. */
  mcpLoginCommands: string[];
  mcpSuggestedPromptsDismissed: boolean;
  /** True once the user has acted on (opened or skipped) the Connect-Slack step. */
  slackStepDismissed: boolean;
  /**
   * Whether the project already has a Slack integration connected.
   * `null` until detected. Prefetched by the tutorial screen as soon as
   * credentials exist so the Connect-Slack step renders the right
   * variant immediately instead of flashing the nudge first.
   */
  slackConnected: boolean | null;
  skillsComplete: boolean;
  outroDismissed: boolean;

  /**
   * Self-driving only: whether to integrate PostHog as part of this run.
   * `null` until decided. When detection finds no PostHog SDK, the
   * integration-check screen sets this to `true` (Self-driving needs an SDK,
   * so we always integrate in that case) — and, on the same screen, asks
   * whether the user already has a PostHog account: "yes" leaves `signup`
   * false (OAuth login); "no" flips `signup` and collects `email`/`region`
   * so auth provisions a new account. The `--integrate` flag pre-sets this to
   * `true`, skipping the screen entirely and defaulting to the OAuth login.
   * When `true`, the self-driving prompt has the agent set up the SDK before
   * the Self-driving steps. Unused by other programs.
   */
  integrate: boolean | null;

  /**
   * Ids of composed run steps that have completed — e.g. self-driving's
   * `integrate-run`. Lets a run step's `isComplete` hold after it ran,
   * independent of the shared `runPhase`.
   */
  completedRuns: string[];

  /**
   * Self-driving only: whether the user confirmed the handoff screen shown
   * after the integration run ("PostHog is installed — now set up Self-driving").
   * Gates the Self-driving run so it doesn't start until acknowledged. Only
   * reached in the integrate path; the already-has-PostHog path skips it.
   */
  selfDrivingHandoffConfirmed: boolean;

  /**
   * Self-driving only: whether the project has the PostHog GitHub App
   * connected. `null` until the GitHub gate's first check resolves. Self-driving
   * cannot research issues or open fixes without it, so the gate holds the run
   * until this is `true`.
   */
  githubConnected: boolean | null;

  /**
   * Self-driving only: the user answered "I can't connect right now" on the
   * GitHub gate. Completes the gate step and hides the run step, so the flow
   * lands on the outro without starting the agent.
   */
  githubDeclined: boolean;

  // Runtime
  readinessResult: WizardReadinessResult | null;
  outageDismissed: boolean;
  settingsOverrideKeys: string[] | null;
  settingsConflicts: SettingsConflict[] | null;
  /** Mirrors `AuthErrorDetail` in `@ui/wizard-ui` — keep the two in step. */
  authErrorDetail: {
    hasSettingsConflict: boolean;
    conflicts?: SettingsConflict[];
    usingManagedLogin?: boolean;
    credentialPlaces?: string[];
    sessionExpired?: boolean;
    logFilePath: string;
  } | null;
  portConflictProcess: {
    command: string;
    pid: string;
    port: number;
    user: string;
  } | null;
  /** Copy for the task-notice modal, set while it is open. */
  taskNotice: TaskNotice | null;
  outroData: OutroData | null;
  /** Skill saved for the user's own agent during the handoff. */
  spellbook: { path: string; skillsIncluded: boolean } | null;
  /**
   * How the user left the mint-failure screen: `continue` walks the
   * post-run steps (MCP, Slack, keep-skills), `exit` leaves. Null until then.
   */
  mintHandoff: 'continue' | 'exit' | null;
  dashboardUrl: string | null;
  notebookUrl: string | null;

  // Program metadata (set by runWizard in bin.ts)
  programLabel: string | null;
  skillId: string | null;

  // Resolved framework config (set after integration is known)
  frameworkConfig: FrameworkConfig | null;

  /** Active wizard_ask request, set by the bridge when the agent calls the tool. */
  pendingQuestion: PendingQuestion | null;
}

/**
 * Build a WizardSession from CLI args, pre-populating whatever is known.
 */
export function buildSession(args: {
  debug?: boolean;
  installDir?: string;
  ci?: boolean;
  signup?: boolean;
  /** Harness-only. Set by the e2e TUI host from `E2E_ASK`, never by a flag. */
  e2eAsk?: boolean;
  localDev?: boolean;
  localMcp?: boolean;
  localPosthog?: boolean;
  mcpFeatures?: string[];
  apiKey?: string;
  email?: string;
  region?: CloudRegion;
  baseUrl?: string;
  integration?: Integration;
  benchmark?: boolean;
  yaraReport?: boolean;
  projectId?: string;
  noTelemetry?: boolean;
  harness?: Harness;
  sequence?: Sequence;
  model?: string;
  integrate?: boolean;
  captureAio?: boolean;
}): WizardSession {
  const local = resolveLocalDev(args);
  return {
    debug: args.debug ?? false,
    installDir: args.installDir ?? process.cwd(),
    ci: args.ci ?? false,
    signup: args.signup ?? false,
    e2eAsk: args.e2eAsk ?? false,
    localMcp: local.localMcp,
    mcpFeatures: args.mcpFeatures,
    apiKey: args.apiKey,
    email: args.email,
    region: args.region,
    // `--local-posthog` is sugar over `--base-url`, which every downstream URL
    // helper already honours. An explicit `--base-url` is more specific, so it wins.
    baseUrl:
      args.baseUrl ?? (local.localPosthog ? POSTHOG_LOCAL_URL : undefined),
    benchmark: args.benchmark ?? false,
    yaraReport: args.yaraReport ?? false,
    projectId: parseProjectIdArg(args.projectId),
    noTelemetry: args.noTelemetry ?? false,
    captureAio: args.captureAio ?? false,
    harness: args.harness,
    sequence: args.sequence,
    model: args.model,

    setupConfirmed: false,
    // No screen can ask in a scripted CI run, so granting keeps CI's
    // telemetry as it was. --signup alone still provisions a brand-new
    // account headlessly, and that user has never seen the disclosure — a
    // headless `--ci --signup` run stays covered by the ci branch above.
    scanConsent: args.ci ? ScanConsent.Granted : ScanConsent.Undecided,
    warehouseSourcesReported: false,
    aiSdkStampReported: false,
    integration: args.integration ?? null,
    frameworkContext: {},
    typescript: false,
    detectedFrameworkLabel: null,
    posthogSdkDetected: false,
    detectionComplete: false,
    unsupportedVersion: null,

    runPhase: RunPhase.Idle,
    discoveredFeatures: [],
    mcpComplete: false,
    mcpOutcome: null,
    mcpInstalledClients: [],
    mcpLoginCommands: [],
    mcpSuggestedPromptsDismissed: false,
    slackStepDismissed: false,
    slackConnected: null,
    skillsComplete: false,
    outroDismissed: false,
    // `--integrate` forces integration (skip the question); otherwise the
    // integration-check screen resolves it from null.
    integrate: args.integrate === true ? true : null,
    completedRuns: [],
    selfDrivingHandoffConfirmed: false,
    githubConnected: null,
    githubDeclined: false,
    loginUrl: null,
    authorizeUrl: null,
    credentials: null,
    roleAtOrganization: null,
    apiUser: null,
    apiProject: null,
    readinessResult: null,
    outageDismissed: false,
    settingsOverrideKeys: null,
    settingsConflicts: null,
    authErrorDetail: null,
    portConflictProcess: null,
    taskNotice: null,
    outroData: null,
    spellbook: null,
    mintHandoff: null,
    dashboardUrl: null,
    notebookUrl: null,
    programLabel: null,
    skillId: null,
    frameworkConfig: null,
    pendingQuestion: null,
  };
}

/** One place to ask, so a new consent state does not need three edits. */
export function mayReportScanResults(session: WizardSession): boolean {
  return session.scanConsent === ScanConsent.Granted;
}

/** Lives here so analytics infrastructure never learns what consent means. */
export function reportableDiscoveredFeatures(
  session: WizardSession,
): DiscoveredFeature[] | undefined {
  return mayReportScanResults(session) ? session.discoveredFeatures : undefined;
}

/** Also a scan result, so it travels under the same consent as the rest. */
export function reportablePosthogSdkDetected(
  session: WizardSession,
): boolean | undefined {
  return mayReportScanResults(session) ? session.posthogSdkDetected : undefined;
}
