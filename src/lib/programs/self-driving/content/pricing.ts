/**
 * Self-driving pricing, in one place. It's stated at six points across the run (intro, tips,
 * learn deck, outro), and a price quoted six ways is a price the reader stops trusting.
 */

/** Flat USD charge per report that ships a pull request. */
export const PRICE_PER_PR_USD = 15;

/** One line, for a screen that only has room to say what it costs. */
export const PRICING_SHORT = `Setup and monitoring are free. You pay $${PRICE_PER_PR_USD} when a report ships a PR.`;

/** The same fact at length, plus the bit people are surprised by later. */
export const PRICING_LONG =
  `Scouts, signals, and reports are free. A report that ships a pull request ` +
  `costs a flat $${PRICE_PER_PR_USD}.`;

/** Nothing caps the spend unless you set it, which is worth saying out loud. */
export const NO_DEFAULT_LIMIT =
  'No spending limit is set by default. You can add a monthly one under Usage in your inbox.';
