import fs from 'fs';
import path from 'path';
import {
  AGENT_SKILL_STEPS,
  createSkillWorkflow,
} from '../agent-skill/index.js';
import type { Workflow, WorkflowConfig } from '../workflow-step.js';
import type { WorkflowRun } from '../../agent/agent-runner.js';
import type { WizardSession } from '../../wizard-session.js';
import { AUDIT_ABORT_CASES } from '../audit/detect.js';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  type AuditCheck,
} from '../audit/types.js';
import { AUDIT_SEED_CHECKS } from '../audit/seed.js';
import { logToFile } from '../../../utils/debug';

const AUDIT3000_REPORT_FILE = 'posthog-audit-3000-report.md';

// Five extra checks the v3000 audit adds on top of the base 10.
// IDs must match those referenced in the audit-3000 skill's step files.
const AUDIT3000_EXTRA_CHECKS: AuditCheck[] = [
  {
    id: 'event-naming-standardization',
    area: 'Event Quality',
    label: 'Event naming convention is consistent',
    status: 'pending',
  },
  {
    id: 'event-duplicates-and-bloat',
    area: 'Event Quality',
    label: 'No duplicate or bloated event capture',
    status: 'pending',
  },
  {
    id: 'event-quality-context-review',
    area: 'Event Quality',
    label: 'Event property context reviewed',
    status: 'pending',
  },
  {
    id: 'event-usage-coverage',
    area: 'Event Quality',
    label: 'Captured events match insights / dashboards usage',
    status: 'pending',
  },
  {
    id: 'stale-feature-flags-reviewed',
    area: 'Feature Flags',
    label: 'Stale feature flags reviewed',
    status: 'pending',
  },
];

const AUDIT3000_SEED_CHECKS: AuditCheck[] = [
  ...AUDIT_SEED_CHECKS,
  ...AUDIT3000_EXTRA_CHECKS,
];

// Intro is custom; run/outro reuse the audit screens. Those screens read
// the report path from WorkflowConfig.reportFile, so the v3000 label is
// rendered correctly without forking the screens.
const AUDIT3000_SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-3000-intro',
  run: 'audit-run',
  outro: 'audit-outro',
};

const seedAudit3000Ledger = (installDir: string): void => {
  const target = path.join(installDir, AUDIT_CHECKS_FILE);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(AUDIT3000_SEED_CHECKS, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  logToFile(
    `seedAudit3000Ledger: wrote ${AUDIT3000_SEED_CHECKS.length} entries to ${target}`,
  );
};

const seedBeforeAudit3000Run = (session: WizardSession): void => {
  seedAudit3000Ledger(session.installDir);
  session.frameworkContext[AUDIT_CHECKS_KEY] = AUDIT3000_SEED_CHECKS;
};

const withAudit3000Screens = (steps: Workflow): Workflow =>
  steps.map((step) => {
    const override = AUDIT3000_SCREEN_BY_STEP[step.id];
    return override ? { ...step, screen: override } : step;
  });

const audit3000Steps: Workflow = withAudit3000Screens(AGENT_SKILL_STEPS);

const baseConfig = createSkillWorkflow({
  skillId: 'audit-3000',
  command: 'audit-3000',
  flowKey: 'audit-3000',
  description:
    'Audit an existing PostHog integration (v3000 — adds event quality, stale-flag hygiene, customer enrichment, use-case match)',
  integrationLabel: 'audit-3000',
  customPrompt:
    'Run the audit-3000 skill end-to-end. Follow the step chain starting at references/1-version.md. Do not modify any project files — only create the final audit report and (when enrichment is enabled) the enrichment report.',
  successMessage: `Audit complete! View the report at ./${AUDIT3000_REPORT_FILE}`,
  reportFile: AUDIT3000_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
  spinnerMessage: 'Running PostHog Audit 3000...',
  estimatedDurationMinutes: 6,
  requires: ['posthog-integration'],
  abortCases: AUDIT_ABORT_CASES,
});

const audit3000Run = async (session: WizardSession): Promise<WorkflowRun> => {
  seedBeforeAudit3000Run(session);

  if (!baseConfig.run) {
    throw new Error('audit-3000 workflow has no run configuration.');
  }

  return typeof baseConfig.run === 'function'
    ? baseConfig.run(session)
    : baseConfig.run;
};

export const audit3000Config: WorkflowConfig = {
  ...baseConfig,
  steps: audit3000Steps,
  run: audit3000Run,
};
