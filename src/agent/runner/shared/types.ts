/**
 * Shared types for the runner pipeline. The run contract lives in
 * `@lib/program-run`; the agent re-exports it for its own modules.
 */

import type { Credentials } from '@store/session/wizard-session';
import type { ApiProject } from '@store/api';
import type { LLMProvider } from '@posthog/warlock';

export type {
  PromptContext,
  Credentials,
  AbortCase,
  ProgramRun,
  ProgramRunConfig,
} from '@store/agent-protocol/program-run';

/**
 * Result of the shared bootstrap, consumed by both the linear and the
 * orchestrator arm. `bootstrapProgram` runs `authenticate` before returning, so
 * `credentials` is guaranteed non-null here — the single narrowing point owns
 * the invariant, and downstream readers get a properly non-null type for free.
 */
export interface BootstrapResult {
  skillsBaseUrl: string;
  /** Auth outputs (incl. the resolved host family and its MCP url), narrowed at the boundary. */
  credentials: Credentials;
  /** Program this run is, and the node its gateway spend pins to. */
  programId: string;
  wizardFlags: Record<string, string>;
  /** Flag payloads from the same snapshot (e.g. the self-driving pi `{model, effort?, harness?, sequence?}`). */
  wizardFlagPayloads: Record<string, unknown>;
  wizardMetadata: Record<string, string>;
  /** Full project payload, for project-level prompt context (opt-ins). */
  project: ApiProject | null;
  /** Scan-triage classifier on this run's harness. Undefined → skill scans fail closed. */
  triageProvider: LLMProvider | undefined;
}
