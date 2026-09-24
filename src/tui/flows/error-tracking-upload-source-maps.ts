/**
 * Error tracking source maps upload program step list.
 *
 * Flow: a static intro (no detection yet) → login → an agentic detect+pick
 * screen that scans the repo on Haiku and lets the user choose a project →
 * agent run → outro. Detection runs after auth because the detection agent
 * needs credentials.
 */

import type { FlowStep } from '../flow';
import { RunPhase } from '@shared/run-state';
import { isSourceMapsProjectSelected } from '@programs';

export const ERROR_TRACKING_UPLOAD_SOURCE_MAPS_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'source-maps-intro',
    gate: (session) => session.setupConfirmed,
  },
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'detect',
    label: 'Detecting projects',
    // The Haiku agent scans the repo, surfaces an instrumentable / not-yet map,
    // and the user picks the project to wire up. Advances once a project is
    // chosen (its variant is written to frameworkContext). The gate lets the
    // agent runner park after auth until the pick lands, so the run prompt sees
    // the chosen variant.
    screenId: 'source-maps-detect',
    isComplete: isSourceMapsProjectSelected,
    gate: isSourceMapsProjectSelected,
  },
  {
    id: 'run',
    label: 'Upload source maps',
    screenId: 'run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'source-maps-outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'skills',
    label: 'Skills',
    screenId: 'keep-skills',
  },
];
