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

import type { Integration } from './constants';
import type { FrameworkConfig } from './framework-config';
import type { WizardReadinessResult } from './health-checks/readiness';
import type { SettingsConflict } from './agent/agent-interface';
import type { ApiUser } from './api';

export interface Credentials {
  accessToken: string;
  projectApiKey: string;
  host: string;
  projectId: number;
}

function parseProjectIdArg(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export type CloudRegion = 'us' | 'eu';

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

/** Additional features the agent can integrate after the main setup */
export enum AdditionalFeature {
  LLM = 'llm',
}

/** Human-readable labels for additional features (used in TUI progress) */
export const ADDITIONAL_FEATURE_LABELS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: 'LLM analytics',
};

/** Agent prompts for each additional feature, injected via the stop hook */
export const ADDITIONAL_FEATURE_PROMPTS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: `Now integrate LLM analytics with PostHog. Use the PostHog MCP server to find the appropriate LLM analytics skill, install it, and follow its workflow. PostHog basics are already installed. Update the setup report markdown file when complete with additions from this task. `,
};

/** Outcome of the MCP server installation step */
export enum McpOutcome {
  NoClients = 'no_clients',
  Skipped = 'skipped',
  Installed = 'installed',
  Failed = 'failed',
}

/** Outcome kind for the outro screen */
export enum OutroKind {
  Success = 'success',
  Error = 'error',
  Cancel = 'cancel',
}

export interface OutroData {
  kind: OutroKind;
  /** Main headline (green check for Success, red X for Error, etc.) */
  message?: string;
  /** Free-form body text shown under the headline. Use \n for paragraph breaks. */
  body?: string;
  /** Success-only: bulleted list of "what the agent did" */
  changes?: string[];
  docsUrl?: string;
  continueUrl?: string;
  /** Report file the agent wrote (e.g. "posthog-setup-report.md") */
  reportFile?: string;
  /** PostHog dashboard URL the program created on the user's behalf. */
  dashboardUrl?: string;
}

/** A single question rendered by the WizardAsk overlay. */
export interface AskQuestion {
  /** Key for the response map */
  id: string;
  prompt: string;
  /** text = single-line free input; single/multi = picker */
  kind: 'single' | 'multi' | 'text';
  /** Required for `single` and `multi`. Ignored for `text`. */
  options?: { label: string; value: string }[];
  /** Defaults to true */
  required?: boolean;
  /**
   * Only meaningful for kind='text'. When true, the wizard-tools `wizard_ask`
   * tool stores the user's answer in the session secret vault and returns
   * `{ secretRef }` to the agent instead of the plain string — so the value
   * never enters the LLM conversation. The TUI may also mask input
   * accordingly. See `secret-vault.ts`.
   */
  sensitive?: boolean;
}

/** Map of question id → answer (string for single/text, string[] for multi). */
export type AskAnswers = Record<string, string | string[]>;

/** A pending wizard_ask request held by the store. */
export interface PendingQuestion {
  id: string;
  questions: AskQuestion[];
  /** Skill id of the caller. Set by the wizard from session.skillId. */
  source: string;
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
  localMcp: boolean;
  mcpFeatures?: string[];
  apiKey?: string;
  email?: string;
  region?: CloudRegion;
  benchmark: boolean;
  yaraReport: boolean;
  projectId?: number;
  noTelemetry: boolean;

  // From detection + screens
  setupConfirmed: boolean;
  integration: Integration | null;
  frameworkContext: Record<string, unknown>;
  typescript: boolean;

  /** Human-readable label for the detected framework variant (e.g., "Django with Wagtail CMS") */
  detectedFrameworkLabel: string | null;

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
   * CI-key auth populates it. Schema lives in `src/lib/api.ts` and
   * passes through unknown upstream fields so downstream features can
   * read account context (plan, org name, email, etc.) without
   * re-fetching.
   */
  apiUser: ApiUser | null;

  // Lifecycle
  runPhase: RunPhase;
  loginUrl: string | null;
  // Direct PostHog authorize URL, shown in the manual-paste modal for
  // headless/remote shells (the localhost loginUrl is unreachable there).
  authorizeUrl: string | null;

  // Feature discovery
  discoveredFeatures: DiscoveredFeature[];
  llmOptIn: boolean;

  // ScreenId completion
  mcpComplete: boolean;
  mcpOutcome: McpOutcome | null;
  mcpInstalledClients: string[];
  mcpSuggestedPromptsDismissed: boolean;
  skillsComplete: boolean;
  outroDismissed: boolean;

  // Runtime
  readinessResult: WizardReadinessResult | null;
  outageDismissed: boolean;
  settingsOverrideKeys: string[] | null;
  settingsConflicts: SettingsConflict[] | null;
  authErrorDetail: {
    hasSettingsConflict: boolean;
    logFilePath: string;
  } | null;
  portConflictProcess: {
    command: string;
    pid: string;
    port: number;
    user: string;
  } | null;
  outroData: OutroData | null;
  dashboardUrl: string | null;

  // Additional features queue (drained via stop hook after main integration)
  additionalFeatureQueue: AdditionalFeature[];

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
  localMcp?: boolean;
  mcpFeatures?: string[];
  apiKey?: string;
  email?: string;
  region?: CloudRegion;
  integration?: Integration;
  benchmark?: boolean;
  yaraReport?: boolean;
  projectId?: string;
  noTelemetry?: boolean;
}): WizardSession {
  return {
    debug: args.debug ?? false,
    installDir: args.installDir ?? process.cwd(),
    ci: args.ci ?? false,
    signup: args.signup ?? false,
    localMcp: args.localMcp ?? false,
    mcpFeatures: args.mcpFeatures,
    apiKey: args.apiKey,
    email: args.email,
    region: args.region,
    benchmark: args.benchmark ?? false,
    yaraReport: args.yaraReport ?? false,
    projectId: parseProjectIdArg(args.projectId),
    noTelemetry: args.noTelemetry ?? false,

    setupConfirmed: false,
    integration: args.integration ?? null,
    frameworkContext: {},
    typescript: false,
    detectedFrameworkLabel: null,
    detectionComplete: false,
    unsupportedVersion: null,

    runPhase: RunPhase.Idle,
    discoveredFeatures: [],
    llmOptIn: false,
    mcpComplete: false,
    mcpOutcome: null,
    mcpInstalledClients: [],
    mcpSuggestedPromptsDismissed: false,
    skillsComplete: false,
    outroDismissed: false,
    loginUrl: null,
    authorizeUrl: null,
    credentials: null,
    roleAtOrganization: null,
    apiUser: null,
    readinessResult: null,
    outageDismissed: false,
    settingsOverrideKeys: null,
    settingsConflicts: null,
    authErrorDetail: null,
    portConflictProcess: null,
    outroData: null,
    dashboardUrl: null,
    additionalFeatureQueue: [],
    programLabel: null,
    skillId: null,
    frameworkConfig: null,
    pendingQuestion: null,
  };
}
