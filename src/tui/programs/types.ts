/**
 * What a program's TUI entry (`programs/<id>/index.ts`) gives the TUI. The
 * core reads these through the registry and names no program: the router
 * walks `flow`, the screen registry mounts `screens`, the run screen shows
 * `deck` and `tips`.
 */

import type { ReactNode } from 'react';
import type { ProgramId } from '@programs/types';
import type { ContentBlock } from '../primitives/index.js';
import type { Tip } from '../components/TipsCard.js';
import type { WizardStore } from '../store.js';
import type { FlowStep } from '../flow.js';
import type { ScreenServices } from '../screen-registry.js';

/** Renders one screen for a store. */
export type ScreenFactory = (
  store: WizardStore,
  services: ScreenServices,
) => ReactNode;

export type TuiProgram = {
  /** The ordered screen flow. */
  flow: FlowStep[];
  /** LearnCard deck for the run screen. Unset: the generic skill deck. */
  deck?: (store?: WizardStore) => ContentBlock[];
  /** Run-screen tips. Unset: the default tips. */
  tips?: (store?: WizardStore) => Tip[];
  /** The screens this program owns, by screen id. */
  screens?: Readonly<Record<string, ScreenFactory>>;
};

/** A TUI program folder's entry: the TUI program for each program id it serves. */
export type TuiPrograms = Partial<Record<ProgramId, TuiProgram>>;
