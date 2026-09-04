/**
 * A label past its column wraps mid-word and breaks the menu alignment.
 *
 * Covers every menu this screen can render, not just the first one: an earlier
 * version measured the main menu alone, and a label on the privacy menu shipped
 * one character too long.
 */

import { sharingOptions } from '@ui/tui/screens/PostHogIntegrationIntroScreen';
import { introMenuOptions } from '@ui/tui/posthog-integration-intro';

// IntroScreenLayout renders a centered menu in a 24-column box. A row with an
// icon spends four columns before the label: focus marker, gap, glyph, gap.
const MENU_BOX_WIDTH = 24;
const ICON_ROW_PREFIX_WIDTH = 4;
const MAX_MENU_LABEL_LENGTH = MENU_BOX_WIDTH - ICON_ROW_PREFIX_WIDTH;

const menuFor = (view: 'default' | 'more-info', posthogSdkDetected: boolean) =>
  introMenuOptions({ view, showContinue: true, posthogSdkDetected }) ?? [];

// Both detection states: only one offers the spell book and hedged Continue.
const EVERY_LABEL = [
  ...menuFor('default', false),
  ...menuFor('default', true),
  ...menuFor('more-info', true),
  ...sharingOptions(true),
].map((o) => o.label);

describe('PostHogIntegrationIntroScreen menu labels', () => {
  it.each([...new Set(EVERY_LABEL.filter(Boolean))])(
    '"%s" fits the intro menu column',
    (label) => {
      expect(label.length).toBeLessThanOrEqual(MAX_MENU_LABEL_LENGTH);
    },
  );

  it('leaves the disclosure row to the layout', () => {
    // IntroScreenLayout appends it to every intro menu — see its own test.
    // A copy here would drift, which is how the panel got five names.
    for (const view of ['default', 'more-info'] as const) {
      expect(menuFor(view, true).map((o) => o.value)).not.toContain('privacy');
    }
  });

  it('does not ask the user to decide about sharing to continue', () => {
    // The choice lives in the panel. A decline option next to Continue makes
    // the first decision be about data rather than about the wizard.
    const values = menuFor('default', false).map((o) => o.value);
    expect(values).not.toContain('continue-no-scan');
  });
});

describe('the sharing choice', () => {
  it('offers share and decline as two explicit rows', () => {
    const values = sharingOptions(true)
      .filter((o) => !o.disabled)
      .map((o) => o.value);

    // No Back: IntroScreenLayout appends it, so a program cannot omit it.
    expect(values).toEqual(['share', 'no-share']);
  });

  it('marks whichever row is live', () => {
    const [onShare, onDecline] = sharingOptions(true);
    const [offShare, offDecline] = sharingOptions(false);

    expect(onShare.icon?.glyph).not.toBe(onDecline.icon?.glyph);
    expect(offShare.icon?.glyph).toBe(onDecline.icon?.glyph);
    expect(offDecline.icon?.glyph).toBe(onShare.icon?.glyph);
  });

  it('ends with a row navigation skips, to separate the appended Back', () => {
    // A disabled row renders blank and cannot be focused, which is how the
    // menu holds a margin without the layout knowing about it.
    const spacer = sharingOptions(true).at(-1);

    expect(spacer?.disabled).toBe(true);
    expect(spacer?.label).toBe('');
  });
});
