/**
 * Intro-screen copy and menu decisions, extracted from
 * PostHogIntegrationIntroScreen so they can be asserted without a render —
 * vitest aliases `ink` to no-op stubs suite-wide (vitest.config.ts), so the
 * screen itself draws nothing here.
 *
 * These assert the wiring, not the wording: which headline each detection state
 * resolves to, and what order the menu offers. Copy edits land in one place and
 * don't drag the test with them — menu order is pinned on `value` (stable
 * identifiers), and the only label asserted is the one that actually branches.
 */

import {
  CONTINUE_ANYWAY_LABEL,
  CONTINUE_LABEL,
  DEFAULT_HEADLINE,
  DETECTED_HEADLINE,
  introHeadline,
  introMenuOptions,
} from '@ui/tui/posthog-integration-intro';

const valuesFor = (args: {
  view?: 'default' | 'more-info' | 'commands';
  showContinue?: boolean;
  posthogSdkDetected?: boolean;
}): string[] =>
  (
    introMenuOptions({
      view: args.view ?? 'default',
      showContinue: args.showContinue ?? true,
      posthogSdkDetected: args.posthogSdkDetected ?? false,
    }) ?? []
  ).map((option) => option.value);

describe('introHeadline', () => {
  it('leads with the detection when PostHog is already installed', () => {
    expect(introHeadline(true)).toEqual(DETECTED_HEADLINE);
  });

  it('keeps the default headline for a clean project', () => {
    expect(introHeadline(false)).toEqual([DEFAULT_HEADLINE]);
  });

  // Without literals on either side, both assertions above pass vacuously if
  // the two headlines ever collapse to the same copy.
  it('resolves the two states to different copy', () => {
    expect(DETECTED_HEADLINE).not.toEqual([DEFAULT_HEADLINE]);
  });

  // The screen centers a single line and left-aligns a block, so the count is
  // a layout decision rather than an incidental shape.
  it('keeps the clean project to one line and says more on a detection', () => {
    expect(introHeadline(false)).toHaveLength(1);
    expect(introHeadline(true).length).toBeGreaterThan(1);
  });
});

describe('introMenuOptions', () => {
  describe('an install we already detected', () => {
    // The ask: exploring the other commands outranks re-running an
    // integration the project may not need.
    it('offers the tricks before continuing', () => {
      expect(valuesFor({ posthogSdkDetected: true })).toEqual([
        'commands',
        'continue',
        'framework',
        'more-info',
        'cancel',
      ]);
    });

    it('hedges the continue label', () => {
      const options = introMenuOptions({
        view: 'default',
        showContinue: true,
        posthogSdkDetected: true,
      });
      expect(options?.find((o) => o.value === 'continue')?.label).toBe(
        CONTINUE_ANYWAY_LABEL,
      );
    });
  });

  describe('a clean project', () => {
    it('is untouched by any of this', () => {
      expect(valuesFor({ posthogSdkDetected: false })).toEqual([
        'continue',
        'framework',
        'more-info',
        'cancel',
      ]);
    });

    it('continues without the hedge', () => {
      const options = introMenuOptions({
        view: 'default',
        showContinue: true,
        posthogSdkDetected: false,
      });
      expect(options?.find((o) => o.value === 'continue')?.label).toBe(
        CONTINUE_LABEL,
      );
    });
  });

  // Same reasoning as the headline pair: with neither side a literal, both
  // label assertions pass vacuously if the two ever collapse.
  it('distinguishes the two continue labels', () => {
    expect(CONTINUE_ANYWAY_LABEL).not.toBe(CONTINUE_LABEL);
  });

  describe('the sub-views', () => {
    // Nothing scopes arrow keys to one picker. The command list is a picker in
    // the body slot, so a menu here would move both cursors at once — the bug
    // this replaced. The screen binds Esc for that view instead.
    it('renders no menu under the command list', () => {
      expect(
        introMenuOptions({
          view: 'commands',
          showContinue: true,
          posthogSdkDetected: true,
        }),
      ).toBeNull();
    });

    // IntroScreenLayout appends the disclosure row to every intro menu, so
    // neither sub-view carries its own route to it.
    it('gives the more-info view a way back and nothing else', () => {
      expect(valuesFor({ view: 'more-info' })).toEqual(['back']);
    });
  });

  // Detecting, picking a framework, and the unsupported-version prompt all
  // clear showContinue — the screen owns the interaction, so no menu renders.
  it('renders no menu when there is nothing to continue to', () => {
    expect(
      introMenuOptions({
        view: 'default',
        showContinue: false,
        posthogSdkDetected: true,
      }),
    ).toBeNull();
  });
});
