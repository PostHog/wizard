/** The metrics TUI: the skill flow and deck behind its own intro. */
import type { TuiPrograms } from '@tui/programs/types';
import { skillFlow } from '@tui/programs/shared/skill-flow';
import { getContentBlocks } from '@tui/programs/shared/skill-deck';
import { MetricsScreenId } from './screen-ids.js';
import { MetricsIntroScreen } from './screens/MetricsIntroScreen.js';

export { MetricsScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  metrics: {
    flow: skillFlow(MetricsScreenId.Intro),
    deck: getContentBlocks,
    screens: {
      [MetricsScreenId.Intro]: (store) => <MetricsIntroScreen store={store} />,
    },
  },
};
