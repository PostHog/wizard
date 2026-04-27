import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSkillWorkflow } from '../agent-skill/index.js';
import { OutroKind } from '../../wizard-session.js';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  coerceAuditChecks,
} from './types.js';

const REPORT_FILE = 'posthog-audit-report.md';

function openReport(absolutePath: string): void {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';
  try {
    spawn(cmd, [absolutePath], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // best-effort; ignore failures
  }
}

export const auditConfig = createSkillWorkflow({
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
});
