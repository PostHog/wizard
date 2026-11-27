/**
 * Self-driving pricing, in one place. It's stated at several points across the run (intro, tips,
 * learn deck, outro), and a price quoted several ways is a price the reader stops trusting.
 *
 * Self-driving bills by usage in AI credits, the same credits PostHog AI uses (1 credit = $0.01).
 * Every piece of agent work spends credits: processing signals, scout runs, research, and fixes
 * when automatic PRs are on. There is no flat per-PR price. Source of truth:
 * https://posthog.com/docs/self-driving/pricing
 */

/** One line, for a screen that only has room to say what it costs. */
export const PRICING_SHORT =
  'Self-driving uses the same credits as PostHog AI.';

/** What the credits pay for. Kept under one learn-deck beat (4 lines of the 37-char pane). */
export const PRICING_WORK =
  'You pay for the work agents do: watching your sources, running scouts, ' +
  'researching reports, and writing fixes if you turn them on.';

export const PRICING_SIZE = 'Bigger jobs use more credits.';

/** The same facts at length, for screens with room for a paragraph. */
export const PRICING_LONG = `${PRICING_SHORT} ${PRICING_WORK} ${PRICING_SIZE}`;

/** Where the spend cap lives. Billing limits are set per organization, not in the inbox. */
export const SPEND_CAP =
  "You can of course configure a cap in your organization's billing settings.";
