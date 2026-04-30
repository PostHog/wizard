import {
  AGENT_SKILL_STEPS,
  createSkillWorkflow,
} from '../agent-skill/index.js';
import type {
  Workflow,
  WorkflowConfig,
  WorkflowReadyContext,
} from '../workflow-step.js';
import { AUDIT_ABORT_CASES } from './detect.js';
import { AUDIT_CHECKS_KEY, AUDIT_REPORT_FILE } from './types.js';
import { AUDIT_SEED_CHECKS, seedAuditLedger } from './seed.js';

/** Audit reuses the agent-skill step pipeline but swaps in audit-specific
 *  screens for intro / run / outro. The screen names are registered in
 *  `screen-registry.tsx`. */
const AUDIT_SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-intro',
  run: 'audit-run',
  outro: 'audit-outro',
};

/**
 * Workflow-start hook: write the 9 pending checks to the ledger before the
 * agent runs. Static seed → no agent turn wasted on `audit_seed_checks`.
 */
const seedOnIntro = (ctx: WorkflowReadyContext): void => {
  seedAuditLedger(ctx.session.installDir);
  ctx.setFrameworkContext(AUDIT_CHECKS_KEY, AUDIT_SEED_CHECKS);
};

const withAuditScreens = (steps: Workflow): Workflow =>
  steps.map((step) => {
    const override = AUDIT_SCREEN_BY_STEP[step.id];
    return override ? { ...step, screen: override } : step;
  });

const withSeedHook = (steps: Workflow): Workflow =>
  steps.map((step) =>
    step.id === 'intro' ? { ...step, onReady: seedOnIntro } : step,
  );

const auditSteps: Workflow = withSeedHook(withAuditScreens(AGENT_SKILL_STEPS));

const baseConfig = createSkillWorkflow({
  skillId: 'audit',
  command: 'audit',
  flowKey: 'audit',
  description:
    'Audit an existing PostHog integration for correctness and best practices',
  integrationLabel: 'audit',
  customPrompt:
    'Run a comprehensive audit of the existing PostHog integration. Follow the skill workflow steps in order. Do not modify any project files — only create the final audit report.',
  successMessage: 'Audit complete!',
  reportFile: AUDIT_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
  spinnerMessage: 'Auditing PostHog integration...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],
  abortCases: AUDIT_ABORT_CASES,
});

export const auditConfig: WorkflowConfig = { ...baseConfig, steps: auditSteps };
