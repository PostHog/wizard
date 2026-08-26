/**
 * `[ABORT] <reason>` normalization.
 *
 * The reason is a substring of the model's own prose, captured to end-of-line,
 * so it arrives with whatever markdown the model wrapped it in — a stray
 * closing backtick, bold markers, a trailing period. Normalizing once at the
 * capture point means every downstream consumer (the `AbortCase` regexes that
 * pick the error screen, and the `reason` on `wizard: agent aborted`) sees the
 * same clean value instead of each having to tolerate the noise.
 *
 * Only wrapper punctuation is stripped. Anything the model added *inside* the
 * phrase stays, so a program's `AbortCase.match` should stay prefix-anchored
 * rather than assuming an exact end-of-string.
 */

/** Markdown / quoting noise the model wraps a reason in. */
const LEADING_NOISE = /^[\s`*_~"'[(]+/;
const TRAILING_NOISE = /[\s`*_~"'\]).,:;!]+$/;

export function normalizeAbortReason(raw: string): string {
  return raw
    .replace(LEADING_NOISE, '')
    .replace(TRAILING_NOISE, '')
    .replace(/\s+/g, ' ')
    .trim();
}
