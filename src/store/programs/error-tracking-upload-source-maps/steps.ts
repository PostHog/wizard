/**
 * Error tracking source maps upload program step list.
 *
 * Flow: a static intro (no detection yet) → login → an agentic detect+pick
 * screen that scans the repo on Haiku and lets the user choose a project →
 * agent run → outro. Detection runs after auth because the detection agent
 * needs credentials.
 */

import type { ProgramStep } from '../program-step.js';
import type { WizardSession } from '../../session/wizard-session.js';
import { RunPhase } from '../../session/wizard-session.js';
import { SOURCE_MAPS_CONTEXT_KEYS, VARIANT_DISPLAY_NAME } from './detect.js';
import { requireString } from '../../control/params.js';

function projectSelected(session: WizardSession): boolean {
  return (
    session.frameworkContext[SOURCE_MAPS_CONTEXT_KEYS.selectedVariant] != null
  );
}

export const ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM: ProgramStep[] = [
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
    isComplete: projectSelected,
    gate: projectSelected,
    controlActions: [
      {
        id: 'pick_source_maps_project',
        description:
          'Commit the project to wire source-map upload for, as the detect ' +
          "screen's picker would. The candidate list lives in the screen's " +
          'agentic report, so the caller supplies the pick.',
        params: {
          variant: 'skill variant (e.g. "node", "nextjs")',
          path: 'project path relative to the repo root ("." = root)',
        },
        apply: (store, params) => {
          const variant = requireString(
            'pick_source_maps_project',
            params,
            'variant',
          );
          const path = requireString(
            'pick_source_maps_project',
            params,
            'path',
          );
          store.setFrameworkContext(
            SOURCE_MAPS_CONTEXT_KEYS.selectedVariant,
            variant,
          );
          store.setFrameworkContext(
            SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName,
            (VARIANT_DISPLAY_NAME as Record<string, string>)[variant] ??
              variant,
          );
          store.setFrameworkContext(
            SOURCE_MAPS_CONTEXT_KEYS.selectedPath,
            path,
          );
        },
      },
    ],
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
