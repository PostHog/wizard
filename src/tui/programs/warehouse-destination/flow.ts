/** Warehouse-destination program step list. The skill drives the browser handoff and the export. */

import type { FlowStep } from '@tui/flow';
import { RunPhase } from '@shared/run-state';
import { WarehouseDestinationScreenId } from './screen-ids.js';

export const WAREHOUSE_DESTINATION_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: WarehouseDestinationScreenId.Intro,
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
    label: 'Warehouse export',
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
];
