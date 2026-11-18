/** The warehouse-destination TUI: its flow, deck and screens. */
import type { TuiPrograms } from '@tui/programs/types';
import { WAREHOUSE_DESTINATION_FLOW } from './flow.js';
import { getContentBlocks } from './deck/index.js';
import { WarehouseDestinationScreenId } from './screen-ids.js';
import { WarehouseDestinationIntroScreen } from './screens/WarehouseDestinationIntroScreen.js';

export { WarehouseDestinationScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  'warehouse-destination': {
    flow: WAREHOUSE_DESTINATION_FLOW,
    deck: getContentBlocks,
    screens: {
      [WarehouseDestinationScreenId.Intro]: (store) => (
        <WarehouseDestinationIntroScreen store={store} />
      ),
    },
  },
};
