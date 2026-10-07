/** The source-maps upload TUI: its flow, deck and screens. */
import type { TuiPrograms } from '@tui/programs/types';
import { ERROR_TRACKING_UPLOAD_SOURCE_MAPS_FLOW } from './flow.js';
import { getContentBlocks } from './deck/index.js';
import { SourceMapsScreenId } from './screen-ids.js';
import { SourceMapsIntroScreen } from './screens/SourceMapsIntroScreen.js';
import { SourceMapsDetectScreen } from './screens/SourceMapsDetectScreen.js';
import { SourceMapsOutroScreen } from './screens/SourceMapsOutroScreen.js';

export { SourceMapsScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  'error-tracking-upload-source-maps': {
    flow: ERROR_TRACKING_UPLOAD_SOURCE_MAPS_FLOW,
    deck: getContentBlocks,
    screens: {
      [SourceMapsScreenId.Intro]: (store) => (
        <SourceMapsIntroScreen store={store} />
      ),
      [SourceMapsScreenId.Detect]: (store) => (
        <SourceMapsDetectScreen store={store} />
      ),
      [SourceMapsScreenId.Outro]: (store) => (
        <SourceMapsOutroScreen store={store} />
      ),
    },
  },
};
