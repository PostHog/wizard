/**
 * Link-rendering helpers for terminal prompts.
 *
 * Terminals that auto-linkify text scan *visual* lines, so a URL the TUI wraps
 * across lines — or pads with box-border characters — gets a wrong click
 * target: the terminal opens half a URL, or one stitched back together with
 * border glyphs and padding.
 *
 * The fix is an explicit OSC 8 hyperlink: the escape carries the exact target
 * out of band, independent of the visible layout, and Ink's wrap re-emits it on
 * every wrapped line — so the click target stays correct even when the URL
 * wraps to fit the overlay. Each standalone URL gets its own line so the escape
 * brackets exactly one URL. Terminals without OSC 8 support ignore the escape
 * and show the visible text.
 */

// OSC 8 hyperlink escape: ESC ] 8 ; ; <url> BEL <label> ESC ] 8 ; ; BEL.
// Built from char codes so no raw control bytes live in source.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const OSC_8 = `${ESC}]8;;`;

/** Matches an http(s) URL run (no surrounding whitespace). */
const URL_RUN = /https?:\/\/[^\s]+/g;

/** A line whose entire (trimmed) content is a single URL. */
const STANDALONE_URL_LINE = /^https?:\/\/\S+$/;

/** Trailing characters that are punctuation around a URL, not part of it. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"]+$/;

function trimTrailingPunctuation(url: string): string {
  return url.replace(TRAILING_PUNCTUATION, '');
}

/**
 * Wrap `label` (defaults to the URL) in an OSC 8 hyperlink escape pointing
 * at `url`. Terminals that support OSC 8 make the whole run clickable to the
 * exact `url`; terminals that don't render `label` as plain text.
 */
export function osc8Hyperlink(url: string, label: string = url): string {
  return `${OSC_8}${url}${BEL}${label}${OSC_8}${BEL}`;
}

/** Extract every http(s) URL in `text`, trailing punctuation removed. */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_RUN) ?? [];
  return matches.map(trimTrailingPunctuation);
}

export type PromptSegment =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string };

/**
 * Split prompt text into renderable segments, breaking out any line that is
 * *solely* a URL into its own `url` segment. Consecutive non-URL lines stay
 * grouped in one `text` segment (newlines preserved) so paragraph spacing is
 * unchanged. URLs that appear inline within prose are left in the text
 * segment — only standalone-line URLs are special-cased, which is how the
 * wizard's prompts present links a user is meant to open.
 */
export function splitPromptIntoSegments(text: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ type: 'text', value: buffer.join('\n') });
      buffer = [];
    }
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (STANDALONE_URL_LINE.test(trimmed)) {
      flush();
      segments.push({ type: 'url', value: trimTrailingPunctuation(trimmed) });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return segments;
}
