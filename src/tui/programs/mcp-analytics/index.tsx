/** The mcp-analytics TUI: its flow and the intro that picks the server to instrument. */
import type { TuiPrograms } from '@tui/programs/types';
import { MCP_ANALYTICS_FLOW } from './flow.js';
import { McpAnalyticsScreenId } from './screen-ids.js';
import { McpAnalyticsIntroScreen } from './screens/McpAnalyticsIntroScreen.js';

export { McpAnalyticsScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  'mcp-analytics': {
    flow: MCP_ANALYTICS_FLOW,
    screens: {
      [McpAnalyticsScreenId.Intro]: (store) => (
        <McpAnalyticsIntroScreen store={store} />
      ),
    },
  },
};
