/**
 * Audit basic specialists — the always-on subagents whose checks the
 * wizard pre-seeds in the ledger. The runner dispatches these
 * unconditionally after install/init.
 *
 * Discoverable specialists (web-analytics, feature-flags, experiments,
 * llm-analytics, error-tracking) are owned by context-mill's audit
 * SKILL.md, not the wizard. The runner's discovery / dispatch agent
 * decides which to run and enrolls their checks via the
 * `audit_add_checks` MCP tool. The wizard never pre-seeds them.
 */

import type { AuditCheck } from './types.js';

export interface AuditSpecialist {
  /** Context-mill skill ID the runner installs before dispatch. */
  skillId: string;
  /** Area label used in the report and ledger. */
  area: string;
  /** Pre-seeded checks owned by this specialist. */
  checks: ReadonlyArray<Omit<AuditCheck, 'status'>>;
}

export const AUDIT_SPECIALISTS: ReadonlyArray<AuditSpecialist> = [
  {
    skillId: 'audit-subagents-identification',
    area: 'Identification',
    checks: [
      {
        id: 'identify-stable-distinct-id',
        area: 'Identification',
        label: 'Stable distinct_id (not session UUID)',
      },
      {
        id: 'identify-not-late',
        area: 'Identification',
        label: 'identify() called before captures / flag evals',
      },
      {
        id: 'cross-runtime-distinct-id',
        area: 'Identification',
        label: 'Same distinct_id across client and server',
      },
      {
        id: 'identify-reset-on-logout',
        area: 'Identification',
        label: 'reset() called on logout / account switch',
      },
    ],
  },
  {
    skillId: 'audit-subagents-event-capture',
    area: 'Event Capture',
    checks: [
      {
        id: 'capture-event-names-static',
        area: 'Event Capture',
        label: 'Event names are static and consistent',
      },
      {
        id: 'capture-uses-proxy',
        area: 'Event Capture',
        label: 'Captures route through a reverse proxy',
      },
      {
        id: 'capture-growth-events',
        area: 'Event Capture',
        label: 'Key activation events captured',
      },
    ],
  },
];
