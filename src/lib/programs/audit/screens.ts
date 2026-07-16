/**
 * The audit's screen overrides for the shared agent-skill step list.
 *
 * Kept apart from the program itself so both audit implementations (local and
 * cloud) can wear the same TUI without importing each other — audit/index.ts
 * hands off to the cloud program behind a flag, so a shared import there would
 * be a cycle.
 */
import type { ProgramStep } from '@lib/programs/program-step';

/** Audit-specific screens for the shared agent-skill pipeline. */
export const AUDIT_SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-intro',
  run: 'audit-run',
  outro: 'audit-outro',
};

export const withAuditScreens = (steps: ProgramStep[]): ProgramStep[] =>
  steps.map((step) => {
    const override = AUDIT_SCREEN_BY_STEP[step.id];
    return override ? { ...step, screenId: override } : step;
  });
