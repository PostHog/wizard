import {
  CONTINUE_ANYWAY_LABEL,
  CONTINUE_LABEL,
  DEFAULT_HEADLINE,
  DETECTED_HEADLINE,
  introEntries,
  introHeadline,
  introMenuOptions,
} from '@tui/programs/posthog-integration/intro-menu';

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

  // Both assertions above pass vacuously if the two ever collapse.
  it('resolves the two states to different copy', () => {
    expect(DETECTED_HEADLINE).not.toEqual([DEFAULT_HEADLINE]);
  });
});

describe('introMenuOptions', () => {
  describe('an install we already detected', () => {
    // Exploring outranks re-running an integration the project may not need.
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

  // Same vacuous-pass risk as the headline pair.
  it('distinguishes the two continue labels', () => {
    expect(CONTINUE_ANYWAY_LABEL).not.toBe(CONTINUE_LABEL);
  });

  describe('the sub-views', () => {
    // A menu here would fight the body's picker for the arrow keys.
    it('renders no menu under the command list', () => {
      expect(
        introMenuOptions({
          view: 'commands',
          showContinue: true,
          posthogSdkDetected: true,
        }),
      ).toBeNull();
    });

    // IntroScreenLayout appends the disclosure row, so no view carries one.
    it('gives the more-info view a way back and nothing else', () => {
      expect(valuesFor({ view: 'more-info' })).toEqual(['back']);
    });
  });

  // Detecting, framework-picking and unsupported all clear showContinue.
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

describe('introEntries', () => {
  // The list is curated, so an id that stops matching drops its row in silence.
  it("offers the intro's programs and tools, in order, all resolving", () => {
    expect(introEntries().map((entry) => entry.id)).toEqual([
      'self-driving',
      'error-tracking-upload-source-maps',
      'warehouse-source',
      'audit',
      'posthog-doctor',
      'mcp-analytics',
      'replay-vision',
      'ai-observability',
      'metrics',
      'revenue-analytics-setup',
    ]);
  });

  // A row wider than the terminal stops the whole block from centering.
  it('keeps every row inside an 80-column terminal', () => {
    const COMMAND_COLUMN = 21;
    const MARKER_PREFIX = 2;
    const BUDGET = 80 - COMMAND_COLUMN - MARKER_PREFIX;

    const tooLong = introEntries()
      .filter((entry) => entry.description.length > BUDGET)
      .map((entry) => `${entry.id} (${entry.description.length})`);

    expect(tooLong).toEqual([]);
  });
});
