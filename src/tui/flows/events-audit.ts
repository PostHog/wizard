/**
 * Events-audit program.
 *
 * Mirrors the posthog-integration step list, except:
 *   - The initial framework detection step is omitted — the events-audit
 *     skill handles detection at agent run time.
 *   - The intro step uses the audit intro screen (no framework selection
 *     logic) instead of the integration intro.
 */

import type { FlowStep } from '../flow';
import { needsFrameworkSetup } from '@programs';
import { RunPhase } from '@shared/run-state';
import { HEALTH_CHECK_STEP } from './health-check';

export const EVENTS_AUDIT_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'audit-intro',
    gate: (session) => session.setupConfirmed,
  },
  HEALTH_CHECK_STEP,
  {
    id: 'setup',
    label: 'Setup',
    screenId: 'setup',
    show: needsFrameworkSetup,
    isComplete: (session) => !needsFrameworkSetup(session),
  },
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Events audit',
    screenId: 'audit-run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    screenId: 'mcp',
    isComplete: (session) => session.mcpComplete,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'audit-outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'keep-skills',
    label: 'Keep Skills',
    screenId: 'keep-skills',
  },
];
