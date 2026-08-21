/** A label past its column wraps mid-word and breaks the menu alignment. */

import {
  CONTINUE_MENU_OPTIONS,
  CONTINUE_MENU_WIDTH,
} from '@ui/tui/screens/PostHogIntegrationIntroScreen';

// Each row spends one column on the focus marker and one on the gap after it.
const MENU_ROW_PREFIX_WIDTH = 2;
const MAX_MENU_LABEL_LENGTH = CONTINUE_MENU_WIDTH - MENU_ROW_PREFIX_WIDTH;

describe('PostHogIntegrationIntroScreen menu labels', () => {
  it.each(CONTINUE_MENU_OPTIONS)(
    '"$label" fits the intro menu column',
    ({ label }) => {
      expect(label.length).toBeLessThanOrEqual(MAX_MENU_LABEL_LENGTH);
    },
  );
});
