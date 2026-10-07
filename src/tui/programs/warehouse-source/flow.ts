/**
 * Warehouse-source program step list. The skill install and agent run happen
 * in `runProgram`. The skill drives both in-CLI source creation and deep-link
 * emission per detected source.
 */

import type { FlowStep } from '@tui/flow';
import { RunPhase } from '@shared/run-state';

export const WAREHOUSE_SOURCE_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'warehouse-intro',
    gate: (tui) => tui.setupConfirmed,
  },
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: ({ session }) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Data warehouse',
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
