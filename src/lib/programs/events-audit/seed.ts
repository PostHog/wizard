import type { AuditCheck } from '@lib/programs/audit/types';

/**
 * The 6 phases the events-audit skill marches through. One check per area
 * so PendingChecksList renders a clean linear pipeline (area = bold header,
 * single row = the active spinner).
 *
 * Phase ids match what the skill's step files resolve via
 * `mcp__wizard-tools__audit_resolve_checks` as each phase completes.
 */
export const EVENTS_AUDIT_SEED_CHECKS: AuditCheck[] = [
  {
    id: 'detect-sdk',
    area: 'Detect SDK',
    label: 'Identify PostHog SDK(s) in dependencies',
    status: 'pending',
  },
  {
    id: 'scan-sites',
    area: 'Scan capture sites',
    label: 'Grep capture/identify/group call sites',
    status: 'pending',
  },
  {
    id: 'enrich-sites',
    area: 'Enrich',
    label: 'Subagent fan-out to read capture files',
    status: 'pending',
  },
  {
    id: 'query-volume',
    area: 'Query PostHog',
    label: '30-day volume + last_seen via MCP',
    status: 'pending',
  },
  {
    id: 'write-report',
    area: 'Write report',
    label: 'Render posthog-events-audit-report.md',
    status: 'pending',
  },
  {
    id: 'create-dashboard',
    area: 'Create dashboard',
    label: 'Optional: dashboard for resolved events',
    status: 'pending',
  },
];
