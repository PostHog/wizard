import { Harness, Sequence, DEFAULT_AGENT_MODEL } from '@shared/constants';
import type { ProgramConfig } from '@programs/program-contract';
import { WIZARD_TOOL_NAMES } from '@agent';
import { SPEND_AUDIT_SCOPE_ADDITIONS } from './scopes.js';

const SPEND_AUDIT_REPORT_FILE = 'posthog-spend-audit-report.md';

/**
 * `wizard audit spend` — find PostHog volume the project pays for and gets
 * nothing from, fix the code side in a pull request, and list the settings
 * side in a notebook the user acts on.
 *
 * The flow (context-mill `agents/spend-audit`) measures 30-day volumes once,
 * audits each product that has volume, edits the repository, creates insights
 * for events nobody queries, and ends with a report that writes the notebook,
 * the pull request body and the machine-readable result (`publish_result`).
 * The product prices the result from the user's billing, so the run never
 * reads billing and never states a dollar figure.
 */
export const config: ProgramConfig = {
  command: 'spend',
  parentCommand: 'audit',
  description:
    'Find savings in your PostHog setup and open a pull request with the fixes',
  id: 'spend-audit',
  // Orchestrator on pi. The binding routes only; every stage's model and
  // effort are pinned context-mill side in the flow's frontmatter.
  binding: {
    sequence: Sequence.orchestrator,
    harness: Harness.pi,
    model: DEFAULT_AGENT_MODEL,
  },
  // Explicit so renaming the program can't silently detach the flow.
  agentFlow: 'spend-audit',
  // The report task builds its own notebook with the sections the product
  // expects; the handoff is the pull request body alone.
  handoffNotebook: false,
  // The report names the organization's account owner as the user's contact.
  accountOwnerContext: true,
  scansCodebase: true,
  reportFile: SPEND_AUDIT_REPORT_FILE,
  requires: ['posthog-integration'],
  // A cloud run has nobody to answer, and the audit decides from data alone.
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
  oauthScopeAdditions: SPEND_AUDIT_SCOPE_ADDITIONS,
  completionScopeOptional: true,
  run: {
    integrationLabel: 'spend-audit',
    customPrompt: () =>
      `Audit what this project sends to PostHog and find the volume that buys nothing. Measure the last 30 days, fix the code side with minimal edits, list the settings side with exact values, create insights for events nobody queries, and finish with the notebook and the result file. Never change a PostHog project or billing setting, and never state a dollar amount.`,
    successMessage:
      'Spend audit complete! The notebook lists what to change and what the pull request fixes.',
    reportFile: SPEND_AUDIT_REPORT_FILE,
    docsUrl: 'https://posthog.com/docs/product-analytics/cutting-costs',
    spinnerMessage: 'Auditing your PostHog spend...',
    estimatedDurationMinutes: 10,
  },
};

export { SPEND_AUDIT_SCOPE_ADDITIONS } from './scopes.js';
