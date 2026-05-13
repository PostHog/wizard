/**
 * Concierge workflow steps.
 *
 * Minimal flow: intro → auth → run → outro → skills. No MCP, read-only.
 */

import type { Workflow } from '../workflow-step.js';
import { RunPhase } from '../../wizard-session.js';

export const CONCIERGE_STEPS: Workflow = [
  {
    id: 'intro',
    label: 'Welcome',
    screen: 'concierge-intro',
    gate: (session) => session.setupConfirmed,
  },
  {
    id: 'auth',
    label: 'Authentication',
    screen: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Running',
    screen: 'run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screen: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'skills',
    label: 'Skills',
    screen: 'keep-skills',
  },
];
