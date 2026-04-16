/**
 * Generic agent skill step list.
 *
 * Minimal flow: intro → auth → run → outro.
 * No detection, no setup, no MCP, no skills screen.
 */

import type { Workflow } from '../workflow-step.js';
import { RunPhase } from '../../wizard-session.js';

export const AGENT_SKILL_STEPS: Workflow = [
  {
    id: 'intro',
    label: 'Welcome',
    screen: 'agent-skill-intro',
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
];
