/**
 * Screen name vocabulary for the TUI. Resolution of the active screen lives in
 * the store (`WizardStore.currentScreen` over `@lib/flow-resolution`).
 */

import { ScreenId } from './screen-sequences.js';
import { Interrupt } from '@store/state/interrupts';
import { Program, type ProgramId } from '@store/programs/program-registry';

export { ScreenId, Program };
export type { ProgramId };
/** Interrupts, under the name the TUI has always used for them. */
export { Interrupt as Overlay };
export type ScreenName = ScreenId | Interrupt;
