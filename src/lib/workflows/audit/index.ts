import { createSkillWorkflow } from '../agent-skill/index.js';

export const auditConfig = createSkillWorkflow({
  skillId: 'audit-all',
  command: 'audit',
  flowKey: 'audit',
  description:
    'Audit an existing PostHog integration for correctness and best practices',
  integrationLabel: 'audit',
  customPrompt:
    'Run a comprehensive audit of the existing PostHog integration. Follow the skill workflow steps in order. Do not modify any project files — only create the final audit report.',
  successMessage: 'Audit complete!',
  reportFile: 'posthog-audit-report.md',
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
  spinnerMessage: 'Auditing PostHog integration...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],
});
