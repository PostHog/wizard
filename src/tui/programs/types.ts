/**
 * What a program's TUI entry (`programs/<id>/index.ts`) gives the TUI. The
 * core reads these through the registry and names no program: the router
 * walks `flow`, the screen registry mounts `screens`, the run screen shows
 * `deck` and `tips`, control serves `actions` and `setters`, and the intro
 * layout reads `introShowsSkill`.
 */

import type { ReactNode } from 'react';
import type { ProgramId } from '@programs/types';
import type { ContentBlock } from '../primitives/index.js';
import type { Tip } from '../components/TipsCard.js';
import type { WizardStore } from '../store.js';
import type { FlowStep } from '../flow.js';
import type { ScreenServices } from '../screen-registry.js';
import type { ActionDef, SetterDef } from '../control/defs.js';

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
  /**
   * Partial control: the commits on this program's screens, by screen id.
   * An empty list marks a screen with no commit on purpose. An unlisted
   * `*-intro` screen gets the shared confirm-and-continue.
   */
  actions?: Readonly<Record<string, readonly ActionDef[]>>;
  /** Full control: the named setters this program adds to the store's own. */
  setters?: readonly SetterDef[];
  /** The intro lists the session's skill, for a program whose skill is picked at launch. */
  introShowsSkill?: boolean;
};

/** A TUI program folder's entry: the TUI program for each program id it serves. */
export type TuiPrograms = Partial<Record<ProgramId, TuiProgram>>;
