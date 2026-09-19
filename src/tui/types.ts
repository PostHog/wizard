/** Shape of the tui surface. Type-only re-exports keep it free of runtime imports. */
export type { TuiHandle } from './start-tui.js';
export type { ScreenId } from './screen-sequences.js';
export type { ScreenName } from './router.js';
export type { FamilyChild } from './family-picker.js';
export type { ProgramPresentation } from './programs/presentation.js';
import type { UiStore } from './ui-store.js';

/** Presentation state the screens read and commit. */
export type UiStoreApi = Pick<
  UiStore,
  | 'activeScreen'
  | 'lastNavDirection'
  | 'statusExpanded'
  | 'toggleStatusExpanded'
  | 'setStatusExpanded'
  | 'tokenHudVisible'
  | 'toggleTokenHud'
  | 'learnCardBlockIdx'
  | 'setLearnCardBlockIdx'
  | 'learnCardComplete'
  | 'setLearnCardComplete'
  | 'subscribe'
  | 'getSnapshot'
>;
