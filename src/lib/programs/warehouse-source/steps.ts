/**
 * Warehouse-source program step list.
 *
 * The detect step scans for warehouse-source signals. The skill install and
 * agent run live in the program runner (see agent-runner.ts). The skill drives
 * both in-CLI source creation and deep-link emission per detected source.
 */

import type { ProgramStep } from '@lib/programs/program-step';
import { RunPhase } from '@lib/wizard-session';
import { detectWarehousePrerequisites } from './detect.js';

export const WAREHOUSE_SOURCE_PROGRAM: ProgramStep[] = [
  {
    id: 'detect',
    label: 'Detecting data sources',
    // Headless step: no screen. onReady scans installDir and writes the
    // detected sources (or a detectError) to frameworkContext for the
    // intro screen to render.
    onReady: (ctx) =>
      detectWarehousePrerequisites(ctx.session, ctx.setFrameworkContext),
  },
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'warehouse-intro',
    gate: (session) => session.setupConfirmed,
  },
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Data warehouse',
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
