/** The web-analytics doctor TUI: the skill flow and deck. */
import { getContentBlocks } from '@tui/programs/shared/skill-deck';
import type { TuiPrograms } from '@tui/programs/types';
import { WEB_ANALYTICS_DOCTOR_FLOW } from './flow.js';

export const TUI_PROGRAMS: TuiPrograms = {
  'web-analytics-doctor': {
    flow: WEB_ANALYTICS_DOCTOR_FLOW,
    deck: getContentBlocks,
  },
};
