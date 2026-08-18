/**
 * A menu label longer than its column wraps mid-word and breaks the menu's
 * alignment, which is easy to miss until someone screenshots a terminal.
 * This measures every label against the width the screen actually asks for,
 * so widening the menu keeps the check honest instead of stranding a
 * hardcoded number.
 */

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
