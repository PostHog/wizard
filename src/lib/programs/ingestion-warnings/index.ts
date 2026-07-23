import type { AbortCase } from '@lib/agent/agent-runner';
import { createSkillProgram } from '@lib/programs/agent-skill/index';

/**
 * `[ABORT] <reason>` cases the ingestion-warnings skill can emit.
 * Kept in sync with the abort reason declared in the context-mill skill's
 * `description.md` / `references/1-triage.md`.
 */
export const INGESTION_WARNINGS_ABORT_CASES: AbortCase[] = [
  {
    // Skill emits: [ABORT] Could not read ingestion warnings and no PostHog instrumentation found to scan
    match:
      /^could not read ingestion warnings and no posthog instrumentation found to scan$/i,
    message: 'No ingestion warnings to work from',
    body:
      "The wizard couldn't read this project's ingestion warnings and found " +
      'no PostHog SDK usage in this directory to scan for the patterns that ' +
      'cause them. Run this command from the root of the project that sends ' +
      'events to PostHog, signed in to the right project.',
    docsUrl: 'https://posthog.com/docs/data/ingestion-warnings',
  },
];

export const ingestionWarningsConfig = createSkillProgram({
  skillId: 'ingestion-warnings',
  command: 'ingestion-warnings',
  id: 'ingestion-warnings',
  description:
    "Diagnose and fix the instrumentation behind your project's ingestion warnings",
  integrationLabel: 'ingestion-warnings',
  successMessage:
    'Ingestion warnings triaged! See ./posthog-ingestion-warnings-report.md',
  reportFile: 'posthog-ingestion-warnings-report.md',
  docsUrl: 'https://posthog.com/docs/data/ingestion-warnings',
  spinnerMessage: 'Diagnosing ingestion warnings...',
  estimatedDurationMinutes: 5,
  abortCases: INGESTION_WARNINGS_ABORT_CASES,
  requires: ['posthog-integration'],
});
