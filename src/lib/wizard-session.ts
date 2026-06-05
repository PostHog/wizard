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
  Autonomy = 'autonomy',
}

/** Human-readable labels for additional features (used in TUI progress) */
export const ADDITIONAL_FEATURE_LABELS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: 'LLM analytics',
  [AdditionalFeature.Autonomy]: 'Autonomy onboarding',
};

/** Agent prompts for each additional feature, injected via the stop hook */
export const ADDITIONAL_FEATURE_PROMPTS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: `Now integrate LLM analytics with PostHog. Use the PostHog MCP server to find the appropriate LLM analytics skill, install it, and follow its workflow. PostHog basics are already installed. Update the setup report markdown file when complete with additions from this task. `,
  [AdditionalFeature.Autonomy]: `Now plan PostHog Autonomy for this product.

PostHog Autonomy runs two kinds of agents against the user's product:
  - Scouts: scheduled agents (cadence + prompt) that watch one product area.
  - Responders: reactive agents that fire on a signal (a new Error Tracking issue, a new support ticket).

Your job, in one phase:
  1. Look at the code in this project and figure out what product it is. Pick 3 to 6 distinct product areas worth watching with their own Scout — bias toward user-facing surfaces, not infrastructure.
  2. For each area, author a Scout skill file under .posthog/autonomy/scouts/<slug>.md with YAML frontmatter (name, description, cadence, mcp_servers, metadata.type=scout, metadata.area) and a prompt body that tells the Scout exactly what to watch for and which PostHog MCP tools (or other relevant MCPs) to use. Reference real PostHog MCP tools you have access to here — do not invent names.
  3. Decide which Responders to enable. \`error-tracking\` should be enabled by default. \`support\` should be enabled only if you see evidence the project uses PostHog Conversations / PostHog support.
  4. Write a manifest to .posthog/autonomy/autonomy.json matching the schema below.

Each Scout file is essentially a small skill: YAML frontmatter on top, a clear prompt body underneath. Keep it focused on one area, name PostHog MCP tools concretely (e.g. \`mcp__posthog__query-trends\`, \`mcp__posthog__query-error-tracking-issues-list\`, \`mcp__posthog__execute-sql\`, \`mcp__posthog__query-funnel\`, \`mcp__posthog__query-retention\`, \`mcp__posthog__query-session-recordings-list\`), and pick a cadence of "hourly", "daily", or "weekly" appropriate to the area.

autonomy.json schema:
{
  "schemaVersion": 1,
  "generatedAt": "<ISO 8601 timestamp>",
  "project": { "integration": "<framework id>", "host": "<posthog host>", "projectId": <number> },
  "responders": [
    {
      "type": "error-tracking" | "support",
      "enabled": <boolean>,
      "rationale": "<one sentence>",
      "trigger": { "kind": "new_issue" | "issue_reopen" | "volume_spike" | "new_ticket" }
    }
  ],
  "scouts": [
    {
      "id": "<kebab-case slug>",
      "name": "<short human title>",
      "area": "<the product area this watches>",
      "cadence": "hourly" | "daily" | "weekly",
      "skillFile": "scouts/<id>.md",
      "mcpServers": ["posthog", ...],
      "rationale": "<one sentence on why this area earned a scout>"
    }
  ]
}

Skill file shape (for each scouts/<id>.md):
---
name: scout-<id>
description: <one-line trigger summary — when to invoke this scout; this is what determines if the skill loads>
cadence: <hourly|daily|weekly>
mcp_servers:
  - posthog
metadata:
  type: scout
  area: <area string>
---

<the scout's prompt body — concrete, names PostHog MCP tools, says what to surface as a Report vs as a PR>

Skill authoring essentials (from anthropics/skills/skill-creator):
- The \`description\` line is the most important field. It is what an agent reads to decide whether to load this skill. It must clearly state when this scout should fire, in third person ("Scouts X for Y when Z"). Pack it with concrete trigger words.
- Skill body should read as instructions to a future agent — second person ("you", "your"), imperative voice ("query trends, compare to baseline, file a Report if delta > 2x").
- Body sections to include in this order: 1) Purpose (one sentence), 2) Signals to watch (concrete metrics/events with PostHog MCP tool names), 3) How to investigate (the actual workflow), 4) When to ship a PR vs surface a Report.
- Be concrete with thresholds and time windows. "Significant" is bad; "delta > 2x week-over-week over the trailing 7 days" is good.

Constraints:
- Use the Write tool to create the files. Read each file immediately before writing it (commandment).
- Do not run shell commands to make these files.
- If the .posthog/ directory doesn't exist, create it via Write (writing a file auto-creates the parent dir).
- After writing the files, briefly tell the user how many Scouts you planned and which Responders are enabled. Do NOT modify the integration's main setup report file — autonomy is its own concern.
- Stay high-level. Don't ask the user clarifying questions; commit to your best read of the codebase.`,
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
}

/** Map of question id → answer (string for single/text, string[] for multi). */
export type AskAnswers = Record<string, string | string[]>;

/** One PostHog Autonomy Scout as authored by the planning agent. */
export interface AutonomyScout {
  id: string;
  name: string;
  area: string;
  cadence: 'hourly' | 'daily' | 'weekly';
  skillFile: string;
  mcpServers: string[];
  rationale: string;
}

/** One PostHog Autonomy Responder as authored by the planning agent. */
export interface AutonomyResponder {
  type: 'error-tracking' | 'support';
  enabled: boolean;
  rationale: string;
  trigger?: {
    kind: 'new_issue' | 'issue_reopen' | 'volume_spike' | 'new_ticket';
  };
}

/** Parsed contents of .posthog/autonomy/autonomy.json. */
export interface AutonomyPlan {
  schemaVersion: number;
  generatedAt: string;
  project?: { integration?: string; host?: string; projectId?: number };
  responders: AutonomyResponder[];
  scouts: AutonomyScout[];
}

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
  forceInstall: boolean;
  installDir: string;
  ci: boolean;
  signup: boolean;
  localMcp: boolean;
  mcpFeatures?: string[];
  apiKey?: string;
  email?: string;
  region?: CloudRegion;
  menu: boolean;
  benchmark: boolean;
  yaraReport: boolean;
  projectId?: number;
  noTelemetry: boolean;
  /** Behind a hidden flag — when true, plan PostHog Autonomy after main integration. */
  autonomy: boolean;

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

  // Lifecycle
  runPhase: RunPhase;
  loginUrl: string | null;

  // Feature discovery
  discoveredFeatures: DiscoveredFeature[];
  llmOptIn: boolean;

  // ScreenId completion
  mcpComplete: boolean;
  mcpOutcome: McpOutcome | null;
  mcpInstalledClients: string[];
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

  // Autonomy onboarding (gated by --autonomy)
  /** Parsed manifest read from .posthog/autonomy/autonomy.json after the agent writes it. */
  autonomyPlan: AutonomyPlan | null;
  /** True once the user has dismissed the autonomy onboarding screen. */
  autonomyOnboardingDismissed: boolean;

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
  forceInstall?: boolean;
  installDir?: string;
  ci?: boolean;
  signup?: boolean;
  localMcp?: boolean;
  mcpFeatures?: string[];
  apiKey?: string;
  email?: string;
  region?: CloudRegion;
  menu?: boolean;
  integration?: Integration;
  benchmark?: boolean;
  yaraReport?: boolean;
  projectId?: string;
  noTelemetry?: boolean;
  autonomy?: boolean;
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
    email: args.email,
    region: args.region,
    menu: args.menu ?? false,
    benchmark: args.benchmark ?? false,
    yaraReport: args.yaraReport ?? false,
    projectId: parseProjectIdArg(args.projectId),
    noTelemetry: args.noTelemetry ?? false,
    autonomy: args.autonomy ?? false,

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
    skillsComplete: false,
    outroDismissed: false,
    loginUrl: null,
    credentials: null,
    readinessResult: null,
    outageDismissed: false,
    settingsOverrideKeys: null,
    settingsConflicts: null,
    authErrorDetail: null,
    portConflictProcess: null,
    outroData: null,
    dashboardUrl: null,
    additionalFeatureQueue: [],
    autonomyPlan: null,
    autonomyOnboardingDismissed: false,
    programLabel: null,
    skillId: null,
    frameworkConfig: null,
    pendingQuestion: null,
  };
}
