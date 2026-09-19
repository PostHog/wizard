/**
 * Screen name vocabulary for the TUI. Resolution of the active screen lives in
 * the store (`WizardStore.currentScreen` over `state/flow-resolution.ts`).
 */

import { ScreenId } from './screen-sequences.js';
import { Interrupt } from '@store';
import { Program } from '@store/programs';
import type { ProgramId } from '@store/types';

export { ScreenId, Program };
export type { ProgramId };
/** Interrupts, exported as `Overlay` for the screens. */
export { Interrupt as Overlay };
export type ScreenName = ScreenId | Interrupt;
