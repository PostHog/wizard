import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { createSkillProgram } from '@lib/programs/agent-skill/index';
import type { ProgramConfig, ProgramStep } from '@lib/programs/program-step';

export const CULL_FEATURE_FLAGS_REPORT_FILE =
  'posthog-feature-flag-cull-report.md';

// The skill resolves rows through audit_resolve_checks, so the audit run
// screen renders the ledger live instead of a bare spinner.
const withAuditRunScreen = (steps: ProgramStep[]): ProgramStep[] =>
  steps.map((step) =>
    step.id === 'run' ? { ...step, screenId: 'audit-run' } : step,
  );

export const cullFeatureFlagsConfig: ProgramConfig = {
  ...createSkillProgram({
    skillId: 'cull-feature-flags-nextjs',
    command: 'cull-feature-flags',
    id: 'cull-feature-flags',
    description:
      'Find stale PostHog feature flags in this project and remove the ones you pick',
    integrationLabel: 'cull-feature-flags',
    customPrompt:
      'Run the cull-feature-flags skill end-to-end: verify each seeded ledger ' +
      'row at its call site, ask once which flags to remove, apply only those, ' +
      `then write ./${CULL_FEATURE_FLAGS_REPORT_FILE}.`,
    successMessage: `Feature flag cull complete! View the report at ./${CULL_FEATURE_FLAGS_REPORT_FILE}`,
    reportFile: CULL_FEATURE_FLAGS_REPORT_FILE,
    docsUrl: 'https://posthog.com/docs/feature-flags/best-practices',
    spinnerMessage: 'Culling stale feature flags...',
    estimatedDurationMinutes: 5,
  }),
  steps: withAuditRunScreen(AGENT_SKILL_STEPS),
};
