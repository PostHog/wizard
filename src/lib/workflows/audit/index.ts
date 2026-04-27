import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_SKILL_STEPS,
  createSkillWorkflow,
} from '../agent-skill/index.js';
import { OutroKind } from '../../wizard-session.js';
import type { Workflow, WorkflowConfig } from '../workflow-step.js';
import { AUDIT_ABORT_CASES } from './detect.js';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  coerceAuditChecks,
} from './types.js';

const REPORT_FILE = 'posthog-audit-report.md';

const PLATFORM_OPEN_CMD: Record<NodeJS.Platform, string> = {
  darwin: 'open',
  win32: 'start',
  aix: 'xdg-open',
  android: 'xdg-open',
  freebsd: 'xdg-open',
  haiku: 'xdg-open',
  linux: 'xdg-open',
  openbsd: 'xdg-open',
  sunos: 'xdg-open',
  netbsd: 'xdg-open',
  cygwin: 'xdg-open',
};

function openReport(absolutePath: string): void {
  const cmd = PLATFORM_OPEN_CMD[process.platform] ?? 'xdg-open';
  try {
    spawn(cmd, [absolutePath], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Best-effort; user can still open the file manually.
  }
}

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
  buildOutroData: (session) => {
    const reportPath = join(session.installDir, REPORT_FILE);
    const reportExists = existsSync(reportPath);
    if (reportExists) openReport(reportPath);
    return {
      kind: OutroKind.Success,
      message: 'Audit complete!',
      body: reportExists
        ? `Report saved to ${reportPath} — opening it now.`
        : `Report should have been written to ${reportPath} but the file is missing.`,
      reportFile: reportExists ? REPORT_FILE : undefined,
      docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
    };
  },
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
