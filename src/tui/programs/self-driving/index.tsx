/** Self-driving's TUI: its flow, deck, tips and screens. */
import type { TuiPrograms } from '@tui/programs/types';
import { SELF_DRIVING_FLOW } from './flow.js';
import { getContentBlocks } from './deck/index.js';
import { getTips } from './deck/tips.js';
import { SelfDrivingScreenId } from './screen-ids.js';
import { SelfDrivingIntroScreen } from './screens/SelfDrivingIntroScreen.js';
import { SelfDrivingIntegrationCheckScreen } from './screens/SelfDrivingIntegrationCheckScreen.js';
import { SelfDrivingIntegrationDetectScreen } from './screens/SelfDrivingIntegrationDetectScreen.js';
import { SelfDrivingHandoffScreen } from './screens/SelfDrivingHandoffScreen.js';
import { SelfDrivingGitHubScreen } from './screens/SelfDrivingGitHubScreen.js';

export { SelfDrivingScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  'self-driving': {
    flow: SELF_DRIVING_FLOW,
    deck: getContentBlocks,
    tips: getTips,
    screens: {
      [SelfDrivingScreenId.Intro]: (store) => (
        <SelfDrivingIntroScreen store={store} />
      ),
      [SelfDrivingScreenId.IntegrationCheck]: (store) => (
        <SelfDrivingIntegrationCheckScreen store={store} />
      ),
      [SelfDrivingScreenId.IntegrationDetect]: (store) => (
        <SelfDrivingIntegrationDetectScreen store={store} />
      ),
      [SelfDrivingScreenId.Handoff]: (store) => (
        <SelfDrivingHandoffScreen store={store} />
      ),
      [SelfDrivingScreenId.Github]: (store) => (
        <SelfDrivingGitHubScreen store={store} />
      ),
    },
  },
};
