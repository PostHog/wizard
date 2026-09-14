/**
 * The disclosure row belongs to the layout, so every program intro offers it
 * at the top level. Screens used to carry their own, which is how the panel
 * ended up with five names and, on the one screen that had it, two levels of
 * nesting under More info.
 */

import { buildIntroMenu } from '@ui/tui/screens/IntroScreenLayout';
import { PRIVACY_PANEL_LABEL } from '@ui/tui/components/PrivacyPanel';

const values = (options: ReturnType<typeof buildIntroMenu>) =>
  options?.map((o) => o.value);

describe('buildIntroMenu', () => {
  it('appends the disclosure row to a screen menu', () => {
    const menu = buildIntroMenu({
      menuOptions: [
        { label: 'Continue', value: 'continue' },
        { label: 'Cancel', value: 'cancel' },
      ],
    });

    // Above Cancel: leaving stays the last thing offered.
    expect(values(menu)).toEqual(['continue', 'privacy', 'cancel']);
  });

  it('appends at the end when the menu has no Cancel', () => {
    const menu = buildIntroMenu({
      menuOptions: [{ label: 'Continue', value: 'continue' }],
    });

    expect(values(menu)).toEqual(['continue', 'privacy']);
    expect(menu?.at(-1)?.label).toBe(PRIVACY_PANEL_LABEL);
  });

  it('appends it to the default menu too, for screens that pass none', () => {
    expect(values(buildIntroMenu({}))).toEqual([
      'continue',
      'privacy',
      'cancel',
    ]);
  });

  it('adds nothing to a screen with no menu at all', () => {
    // A fatal state renders no menu; there is nothing to select.
    expect(buildIntroMenu({ menuOptions: null })).toBeNull();
  });

  it('leaves it off for a screen that renders the panel itself', () => {
    // The auth overlay is the panel, so the row would nest it inside itself.
    const menu = buildIntroMenu({
      menuOptions: [{ label: 'Back', value: 'back' }],
      showPrivacy: false,
    });

    expect(values(menu)).toEqual(['back']);
  });

  it('shows Back alone on the disclosure view by default', () => {
    expect(values(buildIntroMenu({ showingPrivacy: true }))).toEqual([
      'privacy-back',
    ]);
  });

  it('puts a program that can act on it above Back', () => {
    const menu = buildIntroMenu({
      showingPrivacy: true,
      privacyOptions: [
        { label: 'Share tools', value: 'share' },
        { label: "Don't share tools", value: 'no-share' },
      ],
    });

    expect(values(menu)).toEqual(['share', 'no-share', 'privacy-back']);
  });

  it('aligns the appended Back with rows that carry a glyph', () => {
    const withGlyphs = buildIntroMenu({
      showingPrivacy: true,
      privacyOptions: [
        { label: 'Share tools', value: 'share', icon: { glyph: '◆' } },
      ],
    });
    const plain = buildIntroMenu({
      showingPrivacy: true,
      privacyOptions: [{ label: 'Something', value: 'x' }],
    });

    expect(withGlyphs?.at(-1)?.icon?.glyph).toBe(' ');
    expect(plain?.at(-1)?.icon).toBeUndefined();
  });
});
