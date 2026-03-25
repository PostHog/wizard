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
import type { SettingsConflict } from './agent-interface';

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

/** Features discovered during the startup repo scan */
export enum DiscoveredFeature {
  Stripe = 'stripe',
  LLM = 'llm',
  Amplitude = 'amplitude',
}

/** Additional features the agent can integrate after the main setup */
export enum AdditionalFeature {
  LLM = 'llm',
  AmplitudeMigration = 'amplitude_migration',
}

/** Human-readable labels for additional features (used in TUI progress) */
export const ADDITIONAL_FEATURE_LABELS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: 'LLM analytics',
  [AdditionalFeature.AmplitudeMigration]: 'Amplitude migration',
};

/** Agent prompts for each additional feature, injected via the stop hook */
export const ADDITIONAL_FEATURE_PROMPTS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: `Now integrate LLM analytics with PostHog. Use the PostHog MCP server to find the appropriate LLM analytics skill, install it, and follow its workflow. PostHog basics are already installed. Update the setup report markdown file when complete with additions from this task. `,
  [AdditionalFeature.AmplitudeMigration]: `Now completely migrate this project from Amplitude to PostHog analytics. Treat this as a replacement, not a dual-write setup. Reuse the framework-specific PostHog implementation pattern established by the main integration flow in this same run. If you need to confirm the correct PostHog product analytics setup for this framework, reopen the installed integration skill in .claude/skills and follow its SKILL.md plus the relevant workflow references before changing application code. First verify that PostHog product analytics are fully and correctly implemented for this framework; if the main integration left anything incomplete, finish that work before removing Amplitude. Then audit the repository for Amplitude SDK packages, imports, initialization, identify or group calls, event capture calls, wrapper utilities, and Amplitude-specific environment variables or configuration. Replace them with PostHog equivalents while preserving existing event names, relevant property names, and analytics coverage unless there is a clear reason not to. Remove Amplitude dependencies, imports, dead helper code, stale configuration, and obsolete environment variables when they are no longer used. Before finishing, verify there are no remaining runtime Amplitude references in the repository except lockfiles or intentionally retained docs or historical notes, and explicitly mention any leftovers in the setup report. Update the setup report markdown file when complete with additions from this task. `,
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
  message?: string;
  changes?: string[];
  docsUrl?: string;
  continueUrl?: string;
}

export interface WizardSession {
  // From CLI args
  debug: boolean;
  forceInstall: boolean;
  installDir: string;
  ci: boolean;
  signup: boolean;
  localMcp: boolean;
  mcpFeatures?: string[];
  apiKey?: string;
  menu: boolean;
  benchmark: boolean;
  yaraReport: boolean;
  projectId?: number;

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
  credentials: {
    accessToken: string;
    projectApiKey: string;
    host: string;
    projectId: number;
  } | null;

  // Lifecycle
  runPhase: RunPhase;
  loginUrl: string | null;

  // Feature discovery
  discoveredFeatures: DiscoveredFeature[];

  // Screen completion
  mcpComplete: boolean;
  mcpOutcome: McpOutcome | null;
  mcpInstalledClients: string[];

  // Runtime
  readinessResult: WizardReadinessResult | null;
  outageDismissed: boolean;
  settingsOverrideKeys: string[] | null;
  settingsConflicts: SettingsConflict[] | null;
  portConflictProcess: { command: string; pid: string; user: string } | null;
  outroData: OutroData | null;

  // Additional features queue (drained via stop hook after main integration)
  additionalFeatureQueue: AdditionalFeature[];

  // Resolved framework config (set after integration is known)
  frameworkConfig: FrameworkConfig | null;
}

/**
 * Build a WizardSession from CLI args, pre-populating whatever is known.
 */
export function buildSession(args: {
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  ci?: boolean;
  signup?: boolean;
  localMcp?: boolean;
  mcpFeatures?: string[];
  apiKey?: string;
  menu?: boolean;
  integration?: Integration;
  benchmark?: boolean;
  yaraReport?: boolean;
  projectId?: string;
}): WizardSession {
  return {
    debug: args.debug ?? false,
    forceInstall: args.forceInstall ?? false,
    installDir: args.installDir ?? process.cwd(),
    ci: args.ci ?? false,
    signup: args.signup ?? false,
    localMcp: args.localMcp ?? false,
    mcpFeatures: args.mcpFeatures,
    apiKey: args.apiKey,
    menu: args.menu ?? false,
    benchmark: args.benchmark ?? false,
    yaraReport: args.yaraReport ?? false,
    projectId: parseProjectIdArg(args.projectId),

    setupConfirmed: false,
    integration: args.integration ?? null,
    frameworkContext: {},
    typescript: false,
    detectedFrameworkLabel: null,
    detectionComplete: false,
    unsupportedVersion: null,

    runPhase: RunPhase.Idle,
    discoveredFeatures: [],
    mcpComplete: false,
    mcpOutcome: null,
    mcpInstalledClients: [],
    loginUrl: null,
    credentials: null,
    readinessResult: null,
    outageDismissed: false,
    settingsOverrideKeys: null,
    settingsConflicts: null,
    portConflictProcess: null,
    outroData: null,
    additionalFeatureQueue: [],
    frameworkConfig: null,
  };
}
