/**
 * Self-driving pricing, in one place. It's stated at six points across the run (intro, tips,
 * learn deck, outro), and a price quoted six ways is a price the reader stops trusting.
 *
 * Never quote a figure. What an organization pays depends on its billing plan, which this
 * wizard can't see, so point at the pricing docs and the billing limit instead.
 */

export const PRICING_URL = 'posthog.com/docs/self-driving/pricing';

/** One line, for a screen that only has room to say where the price lives. */
export const PRICING_SHORT = `Pricing for agent work: ${PRICING_URL}`;

/** The same fact at length. */
export const PRICING_LONG =
  'Agent work, from scout runs to research and pull requests, is billed to your PostHog organization. ' +
  `Pricing: ${PRICING_URL}`;

/** How to cap the spend. */
export const SPEND_LIMIT =
  "Set a Self-driving billing limit in your organization's billing settings, and agents pause " +
  'when they reach it.';
