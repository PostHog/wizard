/** The migration TUI: its flow, deck and screens. */
import type { TuiPrograms } from '@tui/programs/types';
import { MIGRATION_FLOW } from './flow.js';
import { getContentBlocks } from './deck/index.js';
import { MigrationScreenId } from './screen-ids.js';
import { MigrationIntroScreen } from './screens/MigrationIntroScreen.js';

export { MigrationScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  migration: {
    flow: MIGRATION_FLOW,
    deck: getContentBlocks,
    screens: {
      [MigrationScreenId.Intro]: (store) => (
        <MigrationIntroScreen store={store} />
      ),
    },
  },
};
