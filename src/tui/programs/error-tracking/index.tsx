/** The error-tracking TUI: its flow, deck, tips, screens and detect commit. */
import { ERROR_TRACKING_PROJECT_PATH_KEY } from '@programs/error-tracking';
import { pickIntegrationTarget } from '@tui/control/defs';
import type { TuiPrograms } from '@tui/programs/types';
import { ERROR_TRACKING_FLOW } from './flow.js';
import { getContentBlocks } from './deck/index.js';
import { getTips } from './deck/tips.js';
import { ErrorTrackingScreenId } from './screen-ids.js';
import { ErrorTrackingIntroScreen } from './screens/ErrorTrackingIntroScreen.js';
import { ErrorTrackingDetectScreen } from './screens/ErrorTrackingDetectScreen.js';

export { ErrorTrackingScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  'error-tracking': {
    flow: ERROR_TRACKING_FLOW,
    deck: getContentBlocks,
    tips: getTips,
    screens: {
      [ErrorTrackingScreenId.Intro]: (store) => (
        <ErrorTrackingIntroScreen store={store} />
      ),
      [ErrorTrackingScreenId.Detect]: (store) => (
        <ErrorTrackingDetectScreen store={store} />
      ),
    },
    actions: {
      [ErrorTrackingScreenId.Detect]: [
        pickIntegrationTarget(ERROR_TRACKING_PROJECT_PATH_KEY),
      ],
    },
  },
};
