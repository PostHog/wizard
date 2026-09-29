/**
 * Generic agent skill step list.
 *
 * Minimal flow: intro → health-check → auth → run → outro → skills.
 * No detection, no setup, no MCP.
 */

import type { FlowStep } from '../../flow.js';
import { RunPhase } from '@shared/run-state';
import { HEALTH_CHECK_STEP } from './health-check-step.js';
import { SkillScreenId } from './screen-ids.js';

export const AGENT_SKILL_STEPS: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: SkillScreenId.Intro,
    gate: (tui) => tui.setupConfirmed,
  },
  HEALTH_CHECK_STEP,
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: ({ session }) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Running',
    screenId: 'run',
    isComplete: ({ session }) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (tui) => tui.outroDismissed,
  },
  {
    id: 'skills',
    label: 'Skills',
    screenId: 'keep-skills',
  },
];

/** The skill flow with a program's own intro screen in place of the generic one. */
export const skillFlow = (introScreenId: string): FlowStep[] =>
  AGENT_SKILL_STEPS.map((step) =>
    step.id === 'intro' ? { ...step, screenId: introScreenId } : step,
  );
