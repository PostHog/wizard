/**
 * Self-driving pricing, in one place. It's stated at six points across the run (intro, tips,
 * learn deck, outro), and a price quoted six ways is a price the reader stops trusting.
 *
 * Careful with the word "free". The tracking this wizard installs bills as ordinary PostHog
 * usage, and scouts are heading for usage-based pricing too — so anything called free here is
 * a promise with an expiry date. State what the PR costs and leave the rest to usage-based
 * billing, which stays true either side of that change.
 */

/** Flat USD charge per report that ships a pull request. */
export const PRICE_PER_PR_USD = 15;

/** One line, for a screen that only has room to say what it costs. */
export const PRICING_SHORT = `Agents charge a flat $${PRICE_PER_PR_USD} per pull request they ship.`;

/** The same fact at length, plus the bit people are surprised by later. */
export const PRICING_LONG =
  `A report that ships a pull request costs a flat $${PRICE_PER_PR_USD}. ` +
  `Everything else follows your usual PostHog usage-based pricing.`;

/**
 * Nothing caps the spend unless you set it, which is worth saying out loud. Checked against
 * billing: `custom_limits_map` starts empty and a product with no custom limit resolves to
 * `usage_limit: None`, i.e. uncapped. A free plan is capped by its own allocation instead,
 * hence the qualifier.
 */
export const NO_DEFAULT_LIMIT =
  'A paid plan has no monthly cap until you set one. Add a PR limit in your inbox sidebar, ' +
  'and agents pause when they hit it.';
