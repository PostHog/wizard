/**
 * Generic agent skill step list.
 *
 * Minimal flow: intro → health-check → auth → run → outro → skills.
 * No detection, no setup, no MCP.
 */

import type { ProgramStep } from '@lib/programs/program-step';
import { RunPhase } from '@lib/wizard-session';
import { HEALTH_CHECK_STEP } from '@lib/programs/shared/health-check-step';

export const AGENT_SKILL_STEPS: ProgramStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'agent-skill-intro',
    gate: (session) => session.setupConfirmed,
  },
  HEALTH_CHECK_STEP,
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Running',
    screenId: 'run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'skills',
    label: 'Skills',
    screenId: 'keep-skills',
  },
];
