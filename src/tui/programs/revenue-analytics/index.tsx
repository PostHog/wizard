/** The revenue-analytics TUI: its flow, deck and screens. */
import type { TuiPrograms } from '@tui/programs/types';
import { REVENUE_ANALYTICS_FLOW } from './flow.js';
import { getContentBlocks } from './deck/index.js';
import { RevenueAnalyticsScreenId } from './screen-ids.js';
import { RevenueIntroScreen } from './screens/RevenueIntroScreen.js';

export { RevenueAnalyticsScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  'revenue-analytics-setup': {
    flow: REVENUE_ANALYTICS_FLOW,
    deck: getContentBlocks,
    screens: {
      [RevenueAnalyticsScreenId.Intro]: (store) => (
        <RevenueIntroScreen store={store} />
      ),
    },
  },
};
