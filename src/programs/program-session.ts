/**
 * ProgramSession: what one program invocation knows and decides.
 *
 * Launch values come from argv and env; detection, login, composition and
 * run outputs are written as the program runs. Hosts extend it with their own
 * state (the TUI adds its screen state to make `WizardSession`).
 */

import { POSTHOG_LOCAL_URL, resolveLocalDev } from '@shared/local-dev';
import { ScanConsent, type DiscoveredFeature } from '@shared/scan-consent';
import type {
  AdditionalFeature,
  Harness,
  Integration,
  Sequence,
} from '@shared/constants';
import type { ApiUser, ApiProject, Credentials } from '@shared/api';
import type { CloudRegion } from '@utils/types';
import type { InferenceAuthProvider, OutroData } from '@agent/types';
import type { FrameworkConfig } from './framework-config';

function parseProjectIdArg(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export interface ProgramSession {
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
   * the env var — so a normal `--ci` run is unchanged. See `isAskDisabled`.
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
  /**
   * Gates reporting only; local detection runs either way. Reporting treats
   * 'undecided' as 'declined', so a path that reports before the user was
   * asked sends nothing rather than everything.
   */
  scanConsent: ScanConsent;
  /** Guards against reporting twice; consent resolves from two paths. */
  warehouseSourcesReported: boolean;
  /**
   * Latched once the organization's AI SDK stamp was considered for this login:
   * by run-wizard.ts's auth step (`maybeStampAiSdkDetected`), or by runProgram,
   * whose latch the legacy adapter mirrors back, whichever logs in first.
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
  credentials: Credentials | null;
  /** Host-supplied inference auth for legacy steps that run before the callable host. */
  inferenceAuth?: InferenceAuthProvider;
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
  discoveredFeatures: DiscoveredFeature[];
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
  outroData: OutroData | null;
  dashboardUrl: string | null;
  notebookUrl: string | null;
  additionalFeatureQueue: AdditionalFeature[];
  skillId: string | null;
  frameworkConfig: FrameworkConfig | null;
}

/** Launch values a host parses from argv and env. */
export type ProgramLaunchArgs = {
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
};

/** A program session from launch values, with nothing detected or decided yet. */
export function buildProgramSession(args: ProgramLaunchArgs): ProgramSession {
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
    discoveredFeatures: [],
    // `--integrate` forces integration (skip the question); otherwise the
    // integration-check screen resolves it from null.
    integrate: args.integrate === true ? true : null,
    completedRuns: [],
    credentials: null,
    roleAtOrganization: null,
    apiUser: null,
    apiProject: null,
    outroData: null,
    dashboardUrl: null,
    notebookUrl: null,
    additionalFeatureQueue: [],
    skillId: null,
    frameworkConfig: null,
  };
}
