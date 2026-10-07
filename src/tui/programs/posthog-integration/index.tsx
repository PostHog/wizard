/** The integration program's TUI: its flow, deck and intro. */
import type { TuiPrograms } from '@tui/programs/types';
import { POSTHOG_INTEGRATION_FLOW } from './flow.js';
import { getContentBlocks } from './deck/index.js';
import { PostHogIntegrationScreenId } from './screen-ids.js';
import { PostHogIntegrationIntroScreen } from './screens/PostHogIntegrationIntroScreen.js';

export { PostHogIntegrationScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  'posthog-integration': {
    flow: POSTHOG_INTEGRATION_FLOW,
    deck: getContentBlocks,
    screens: {
      [PostHogIntegrationScreenId.Intro]: (store) => (
        <PostHogIntegrationIntroScreen store={store} />
      ),
    },
  },
};
