import {
  AGENT_SKILL_STEPS,
  createSkillWorkflow,
} from '../agent-skill/index.js';
import type { Workflow, WorkflowConfig } from '../workflow-step.js';
import type { WorkflowRun } from '../../agent/agent-runner.js';
import type { WizardSession } from '../../wizard-session.js';
import { AUDIT_ABORT_CASES } from './detect.js';
import { AUDIT_CHECKS_KEY, AUDIT_REPORT_FILE } from './types.js';
import { AUDIT_SEED_CHECKS, seedAuditLedger } from './seed.js';

/** Audit-specific screens for the shared agent-skill pipeline. */
const AUDIT_SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-intro',
  run: 'audit-run',
  outro: 'audit-outro',
};

const seedBeforeAuditRun = (session: WizardSession): void => {
  seedAuditLedger(session.installDir);
  session.frameworkContext[AUDIT_CHECKS_KEY] = AUDIT_SEED_CHECKS;
};

const withAuditScreens = (steps: Workflow): Workflow =>
  steps.map((step) => {
    const override = AUDIT_SCREEN_BY_STEP[step.id];
    return override ? { ...step, screen: override } : step;
  });

const auditSteps: Workflow = withAuditScreens(AGENT_SKILL_STEPS);

const baseConfig = createSkillWorkflow({
  skillId: 'audit',
  command: 'audit',
  flowKey: 'audit',
  description:
    'Audit an existing PostHog integration for correctness and best practices',
  integrationLabel: 'audit',
  customPrompt:
    'Run a comprehensive audit of the existing PostHog integration. Follow the skill workflow steps in order. Do not modify any project files — only create the final audit report.',
  successMessage:
    'Audit complete! You can view the audit report at ./posthog-audit-report.md',
  reportFile: AUDIT_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
  spinnerMessage: 'Auditing PostHog integration...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],
  abortCases: AUDIT_ABORT_CASES,
});

const auditRun = async (session: WizardSession): Promise<WorkflowRun> => {
  seedBeforeAuditRun(session);

  if (!baseConfig.run) {
    throw new Error('Audit workflow has no run configuration.');
  }

  return typeof baseConfig.run === 'function'
    ? baseConfig.run(session)
    : baseConfig.run;
};

export const auditConfig: WorkflowConfig = {
  ...baseConfig,
  steps: auditSteps,
  run: auditRun,
};
