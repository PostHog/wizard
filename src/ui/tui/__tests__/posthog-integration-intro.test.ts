/**
 * Intro-screen copy decisions, extracted from PostHogIntegrationIntroScreen so
 * they can be asserted without a render — vitest aliases `ink` to no-op stubs
 * suite-wide (vitest.config.ts), so the screen itself draws nothing here.
 *
 * These assert the wiring, not the wording: which headline each detection state
 * resolves to. Copy edits land in one place and don't drag the test with them.
 */

import {
  DEFAULT_HEADLINE,
  DETECTED_HEADLINE,
  introHeadline,
} from '@ui/tui/posthog-integration-intro';

describe('introHeadline', () => {
  it('leads with the detection when PostHog is already installed', () => {
    expect(introHeadline(true)).toBe(DETECTED_HEADLINE);
  });

  it('keeps the default headline for a clean project', () => {
    expect(introHeadline(false)).toBe(DEFAULT_HEADLINE);
  });

  // Without literals on either side, both assertions above pass vacuously if
  // the two headlines ever collapse to the same string.
  it('resolves the two states to different copy', () => {
    expect(DETECTED_HEADLINE).not.toBe(DEFAULT_HEADLINE);
  });
});
