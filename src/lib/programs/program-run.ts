/**
 * A program's agent run definition.
 *
 * Every program provides one of these — either as a static object or via a
 * function that builds one from the session. The agent reads the
 * `AgentRunDefinition` part; the three hooks below take the wizard session and
 * are bound by `run-agent-legacy.ts` before the agent sees them.
 */

import type { Credentials, WizardSession } from '@lib/wizard-session';
import type { AgentRunDefinition } from '@lib/agent/runner/shared/types';

export type {
  AbortCase,
  AgentRunDefinition,
  PromptContext,
} from '@lib/agent/runner/shared/types';
export type { Credentials };

export interface ProgramRun extends AgentRunDefinition {
  /** Runs after agent completes, before outro (e.g. env var upload). */
  postRun?: (session: WizardSession, credentials: Credentials) => Promise<void>;
  /** Custom outro data. Omit for default built from successMessage/reportFile/docsUrl. */
  buildOutroData?: (
    session: WizardSession,
    credentials: Credentials,
  ) => WizardSession['outroData'];
  /**
   * Outro bullets for a sequence that composes its own outro data.
   *
   * `buildOutroData` is the linear sequence's seam: it hands the program the
   * whole outro. The orchestrated sequence cannot, because its message is the
   * drain's result — how many steps ran, what was skipped, which conflict the
   * review step left. So a program with next steps to offer had nowhere to put
   * them there, and the integration's data-source links were built and then
   * dropped on every orchestrated run. This hook keeps the message with the
   * sequence and the bullets with the program.
   *
   * `completedSeededTypes` names the runner-seeded task types that finished
   * successfully, so a program can leave out a step its own seeded task
   * already did — the sequence stays ignorant of what any type means.
   */
  buildOutroNextSteps?: (
    session: WizardSession,
    credentials: Credentials,
    completedSeededTypes: readonly string[],
  ) => { heading: string; items: string[] } | undefined;
}
