import {
  AGENT_SKILL_STEPS,
  createSkillWorkflow,
} from '../agent-skill/index.js';
import type { Workflow, WorkflowConfig } from '../workflow-step.js';
import { AUDIT_ABORT_CASES } from './detect.js';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  coerceAuditChecks,
} from './types.js';

const REPORT_FILE = 'posthog-audit-report.md';

/** Audit reuses the agent-skill step pipeline but swaps in audit-specific
 *  screens for intro / run / outro. The screen names are registered in
 *  `screen-registry.tsx`. */
const AUDIT_SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-intro',
  run: 'audit-run',
  outro: 'audit-outro',
};

const auditSteps: Workflow = AGENT_SKILL_STEPS.map((step) => {
  const override = AUDIT_SCREEN_BY_STEP[step.id];
  return override ? { ...step, screen: override } : step;
});

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
  reportFile: REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
  spinnerMessage: 'Auditing PostHog integration...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],
  fileWatchers: [
    {
      filename: AUDIT_CHECKS_FILE,
      onUpdate: (parsed, ctx) => {
        ctx.setFrameworkContext(AUDIT_CHECKS_KEY, coerceAuditChecks(parsed));
      },
    },
  ],
  abortCases: AUDIT_ABORT_CASES,
});

export const auditConfig: WorkflowConfig = { ...baseConfig, steps: auditSteps };
