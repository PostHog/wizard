/**
 * Shared types for the runner pipeline.
 */

import type {
  Credentials,
  AdditionalFeature,
  WizardSession,
} from '@lib/wizard-session';
import type { PromptContext } from '@lib/agent/agent-prompt';
import type { PackageManagerDetector } from '@lib/detection/package-manager';
import type { CloudRegion } from '@utils/types';
import type { ApiProject } from '@lib/api';

export type { PromptContext, Credentials };

/**
 * A known `[ABORT] <reason>` case. First matching entry is rendered on
 * the error outro; unmatched aborts use a generic fallback.
 */
export interface AbortCase {
  match: RegExp;
  message: string;
  body: string;
  docsUrl?: string;
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
    cloudRegion: CloudRegion | undefined,
  ) => WizardSession['outroData'];
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
}

/**
 * Result of the shared bootstrap, consumed by both the linear and the
 * orchestrator arm. Credentials, role, and user are already applied to the
 * session by `bootstrapProgram`; this carries the values both arms still need.
 */
export interface BootstrapResult {
  skillsBaseUrl: string;
  projectApiKey: Credentials['projectApiKey'];
  host: Credentials['host'];
  accessToken: Credentials['accessToken'];
  projectId: Credentials['projectId'];
  cloudRegion: CloudRegion;
  mcpUrl: string;
  wizardFlags: Record<string, string>;
  wizardMetadata: Record<string, string>;
  /** Full project payload, for project-level prompt context (opt-ins). */
  project: ApiProject | null;
}
