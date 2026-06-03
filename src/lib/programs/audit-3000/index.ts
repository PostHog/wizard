import fs from 'fs';
import path from 'path';
import {
  AGENT_SKILL_STEPS,
  createSkillProgram,
} from '@lib/programs/agent-skill/index';
import type { ProgramStep, ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import { AUDIT_ABORT_CASES } from '@lib/programs/audit/detect';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  type AuditCheck,
} from '@lib/programs/audit/types';
import { AUDIT_SEED_CHECKS } from '@lib/programs/audit/seed';
import { logToFile } from '@utils/debug';

const AUDIT3000_REPORT_FILE = 'posthog-audit-3000-report.md';
const AUDIT3000_NOTEBOOK_URL_FILE = '/tmp/posthog-notebook-url.txt';

/**
 * Read the notebook URL that step 10 of the audit-3000 skill writes to
 * `/tmp/posthog-notebook-url.txt`, then delete the file so it never lingers
 * across runs. Returns `null` if the file is missing or unreadable.
 */
const readAndConsumeNotebookUrl = (): string | null => {
  try {
    if (!fs.existsSync(AUDIT3000_NOTEBOOK_URL_FILE)) {
      return null;
    }
    const raw = fs.readFileSync(AUDIT3000_NOTEBOOK_URL_FILE, 'utf8').trim();
    fs.unlinkSync(AUDIT3000_NOTEBOOK_URL_FILE);
    if (!raw || !/^https?:\/\//.test(raw)) {
      return null;
    }
    return raw;
  } catch (err) {
    logToFile(`readAndConsumeNotebookUrl: ${(err as Error).message}`);
    return null;
  }
};

// Extra checks the v3000 audit adds on top of the base 10. IDs must match
// those referenced in the audit-3000 skill's step files (Event Quality,
// stale feature-flag review, session replay [fix + optimize], per-product
// use-case expansion, and phase markers for the post-flags chain).
const AUDIT3000_EXTRA_CHECKS: AuditCheck[] = [
  // ── Event Quality (Step 5) ──
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
  // ── Feature Flags (Step 6) ──
  {
    id: 'stale-feature-flags-reviewed',
    area: 'Feature Flags',
    label: 'Stale feature flags reviewed',
    status: 'pending',
  },
  // ── Session Replay — fix (Step 6b) ──
  {
    id: 'replay-minimum-duration-set',
    area: 'Session Replay',
    label: 'Minimum duration set on init',
    status: 'pending',
  },
  {
    id: 'replay-mask-config',
    area: 'Session Replay',
    label: 'Mask config covers sensitive surfaces',
    status: 'pending',
  },
  {
    id: 'replay-disabled-in-test-envs',
    area: 'Session Replay',
    label: 'Disabled in test / CI environments',
    status: 'pending',
  },
  {
    id: 'replay-strict-minimum-duration',
    area: 'Session Replay',
    label: 'Strict minimum duration enforced',
    status: 'pending',
  },
  // ── Session Replay — optimize (Step 6b cost wave) ──
  {
    id: 'replay-sampling-rate',
    area: 'Session Replay — Optimize',
    label: 'Sampling rate tuned for cost',
    status: 'pending',
  },
  {
    id: 'replay-triggers-configured',
    area: 'Session Replay — Optimize',
    label: 'Triggers configured (event / URL / flag)',
    status: 'pending',
  },
  {
    id: 'replay-network-recording-filtered',
    area: 'Session Replay — Optimize',
    label: 'Network recording filtered',
    status: 'pending',
  },
  {
    id: 'replay-mobile-sampling',
    area: 'Session Replay — Optimize',
    label: 'Mobile sampling configured',
    status: 'pending',
  },
  // ── Stack consolidation (Step 9) ──
  {
    id: 'expansion-product-analytics',
    area: 'Stack consolidation',
    label: 'Product analytics coverage',
    status: 'pending',
  },
  {
    id: 'expansion-error-tracking',
    area: 'Stack consolidation',
    label: 'Error tracking coverage',
    status: 'pending',
  },
  {
    id: 'expansion-llm-observability',
    area: 'Stack consolidation',
    label: 'LLM observability coverage',
    status: 'pending',
  },
  {
    id: 'expansion-session-replay',
    area: 'Stack consolidation',
    label: 'Session replay coverage',
    status: 'pending',
  },
  {
    id: 'expansion-feature-flags',
    area: 'Stack consolidation',
    label: 'Feature flags coverage',
    status: 'pending',
  },
  {
    id: 'expansion-surveys',
    area: 'Stack consolidation',
    label: 'Surveys coverage',
    status: 'pending',
  },
  {
    id: 'expansion-logs',
    area: 'Stack consolidation',
    label: 'Logs coverage',
    status: 'pending',
  },
  {
    id: 'expansion-web-analytics',
    area: 'Stack consolidation',
    label: 'Web analytics coverage',
    status: 'pending',
  },
  // ── Wrap-up & notebook (Steps 7, 8, 10 phase markers) ──
  // Tracked in the ledger so the UI can surface "did it run / was it
  // skipped" alongside the regular checks. use-case-expansion is omitted
  // because the eight `expansion-*` checks above cover that phase.
  {
    id: 'customer-enrichment',
    area: 'Wrap-up & notebook',
    label: 'Customer enrichment (Harmonic + PDL)',
    status: 'pending',
  },
  {
    id: 'use-case-match',
    area: 'Wrap-up & notebook',
    label: 'Use-case match',
    status: 'pending',
  },
  {
    id: 'final-report',
    area: 'Wrap-up & notebook',
    label: 'Final audit report written',
    status: 'pending',
  },
];

const AUDIT3000_SEED_CHECKS: AuditCheck[] = [
  ...AUDIT_SEED_CHECKS,
  ...AUDIT3000_EXTRA_CHECKS,
];

// Audit-3000 has its own arcade-flavoured intro / run / outro screens. The
// shared audit screens stay reserved for the original `audit` program.
const AUDIT3000_SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-3000-intro',
  run: 'audit-3000-run',
  outro: 'audit-3000-outro',
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

const withAudit3000Screens = (steps: ProgramStep[]): ProgramStep[] =>
  steps.map((step) => {
    const override = AUDIT3000_SCREEN_BY_STEP[step.id];
    return override ? { ...step, screenId: override } : step;
  });

const audit3000Steps: ProgramStep[] = withAudit3000Screens(AGENT_SKILL_STEPS);

const baseConfig = createSkillProgram({
  skillId: 'audit-3000',
  command: 'audit-3000',
  id: 'audit-3000',
  description:
    'Audit an existing PostHog integration (v3000 — adds event quality, stale-flag hygiene, customer enrichment, use-case match)',
  integrationLabel: 'audit-3000',
  customPrompt:
    'Run the audit-3000 skill end-to-end. Follow the step chain starting at references/1-version.md. Do not modify any project files. The ONLY deliverable is the audit notebook created inside the customer PostHog project (via mcp__posthog-wizard__notebooks-create in step 10). IMPORTANT: ignore any later instruction that asks you to write a markdown report file at the project root — the audit notebook IS the report. Do not write posthog-audit-3000-report.md, posthog-audit-report.md, or any similar markdown summary file. Step 7 may stage enrichment content in /tmp; that is fine and is cleaned up in step 10.',
  successMessage: 'Audit complete!',
  reportFile: AUDIT3000_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
  spinnerMessage: 'Running PostHog Audit 3000...',
  estimatedDurationMinutes: 6,
  requires: ['posthog-integration'],
  abortCases: AUDIT_ABORT_CASES,
  buildOutroData: (_sess, _credentials, _cloudRegion) => {
    const notebookUrl = readAndConsumeNotebookUrl();
    return {
      kind: OutroKind.Success,
      message: notebookUrl
        ? 'Audit complete!'
        : 'Audit complete — notebook URL not captured.',
      notebookUrl: notebookUrl ?? undefined,
      docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
    };
  },
});

const audit3000Run = async (session: WizardSession): Promise<ProgramRun> => {
  seedBeforeAudit3000Run(session);

  if (!baseConfig.run) {
    throw new Error('audit-3000 program has no run configuration.');
  }

  return typeof baseConfig.run === 'function'
    ? baseConfig.run(session)
    : baseConfig.run;
};

export const audit3000Config: ProgramConfig = {
  ...baseConfig,
  steps: audit3000Steps,
  run: audit3000Run,
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
};
