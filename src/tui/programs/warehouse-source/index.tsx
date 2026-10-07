/** The warehouse-source TUI: its flow, deck and screens. */
import type { TuiPrograms } from '@tui/programs/types';
import { WAREHOUSE_SOURCE_FLOW } from './flow.js';
import { getContentBlocks } from './deck/index.js';
import { WarehouseSourceScreenId } from './screen-ids.js';
import { WarehouseIntroScreen } from './screens/WarehouseIntroScreen.js';

export { WarehouseSourceScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  'warehouse-source': {
    flow: WAREHOUSE_SOURCE_FLOW,
    deck: getContentBlocks,
    screens: {
      [WarehouseSourceScreenId.Intro]: (store) => (
        <WarehouseIntroScreen store={store} />
      ),
    },
  },
};
