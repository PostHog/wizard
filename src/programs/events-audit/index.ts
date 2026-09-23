import type { ProgramConfig } from '../run/program-step';
import type { ProgramRun } from '../run/program-run';
import type { AdditionalFeature } from '@shared/config/constants';
import { OutroKind } from '@agent';
import { isUsingTypeScript } from '@utils/package-json';
import { WIZARD_TOOL_NAMES } from '@agent';
import { resolveEventsAuditRunDefinition } from '../run/resolve-run-definition';
import { AUDIT_CHECKS_FILE, AUDIT_CHECKS_KEY } from '../audit/types';
import { seedAuditLedger } from '../audit/seed';
import { EVENTS_AUDIT_SEED_CHECKS } from './seed.js';

// SETUP_REPORT_FILE is also re-exported for backward compat with existing
// imports from `@programs/events-audit`. EVENT_INVENTORY_FILE and
// EVENT_INVENTORY_PART_PATTERN are only used by yara-hooks, which imports
// them directly from `./constants` — no re-export needed.
import { SETUP_REPORT_FILE } from './constants.js';
export { SETUP_REPORT_FILE };

type EventsAuditRunState = {
  installDir: string;
  typescript: boolean;
  frameworkContext: Record<string, unknown>;
  additionalFeatureQueue: AdditionalFeature[];
};

/**
 * No CLI word of its own since the audit family took over: `wizard audit
 * events` is the live path, and it resolves to the context-mill `audit-events`
 * skill (whose id AuditRunScreen keys its slides on), not to this config.
 * Registered so its id stays resolvable; nothing dispatches to it today.
 */
export const eventsAuditConfig: ProgramConfig = {
  description: 'Audit PostHog event tracking in this project',
  id: 'events-audit',
  skillId: 'events-audit',
  // Top-level reportFile so AuditRunScreen can resolve the report path
  // synchronously without unwrapping the deferred `run` function.
  reportFile: SETUP_REPORT_FILE,
  auditLedgerFile: AUDIT_CHECKS_FILE,
  allowedTools: [
    'Agent',
    WIZARD_TOOL_NAMES.auditSeedChecks,
    WIZARD_TOOL_NAMES.auditAddChecks,
    WIZARD_TOOL_NAMES.auditResolveChecks,
  ],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],

  run: (session: EventsAuditRunState): Promise<ProgramRun> => {
    const typeScriptDetected = isUsingTypeScript({
      installDir: session.installDir,
    });
    session.typescript = typeScriptDetected;

    // Seed the audit ledger so AuditRunScreen has something to render
    // before the agent emits its first check update. The events-audit
    // ledger is the 6-phase pipeline, not the doctor's 10 integrity checks.
    seedAuditLedger(session.installDir, EVENTS_AUDIT_SEED_CHECKS);
    session.frameworkContext[AUDIT_CHECKS_KEY] = EVENTS_AUDIT_SEED_CHECKS;

    const run = resolveEventsAuditRunDefinition({
      typescript: typeScriptDetected,
      additionalFeatureQueue: session.additionalFeatureQueue,
    });
    return Promise.resolve({
      ...run,
      buildOutroData: (sess, credentials) => {
        const cloudUrl = credentials.host.appHost;
        const continueUrl = sess.signup
          ? `${cloudUrl}/products?source=wizard`
          : undefined;
        // The agent emits `[DASHBOARD_URL] <url>` once it creates the
        // dashboard; the SDK-message interceptor stores it on the session.
        // Fall back to the dashboards index if nothing was emitted.
        const dashboardUrl =
          sess.dashboardUrl ?? (cloudUrl ? `${cloudUrl}/dashboard` : undefined);

        // The agent emits `[NOTEBOOK_URL] <url>` once it uploads the report
        // to a PostHog notebook. No fallback: if the notebook upload was
        // skipped (e.g. MCP unavailable) we just don't show a link.
        const notebookUrl = sess.notebookUrl ?? undefined;

        return {
          kind: OutroKind.Success as const,
          message: 'Your events audit was successful',
          reportFile: SETUP_REPORT_FILE,
          changes: [],
          docsUrl: run.docsUrl,
          continueUrl,
          dashboardUrl,
          notebookUrl,
        };
      },
    });
  },
};
