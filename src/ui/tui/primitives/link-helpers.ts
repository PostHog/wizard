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
 * Split prompt text into renderable segments, breaking *every* URL out onto its
 * own `url` segment — whether it sits alone on a line or inline within prose.
 * Pulling it out matters: `LinkText` renders a `url` segment as a single OSC 8
 * hyperlink, so the click target stays the exact full URL even when it wraps. A
 * URL left inline in a `text` segment is plain text the terminal may auto-detect
 * per *visual* line, which opens a broken half-URL when it wraps.
 *
 * Consecutive URL-free lines stay grouped in one `text` segment (newlines
 * preserved) so paragraph spacing is unchanged. The prose surrounding an inline
 * URL is kept as `text` segments before/after it (trailing URL punctuation stays
 * with the prose), so it reads the same minus the link being on its own line.
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
    URL_RUN.lastIndex = 0;
    if (!URL_RUN.test(line)) {
      buffer.push(line);
      continue;
    }
    // The line has at least one URL: emit the buffered prose, then walk the
    // line emitting text/url/text around each URL.
    flush();
    let cursor = 0;
    URL_RUN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_RUN.exec(line)) !== null) {
      const url = trimTrailingPunctuation(match[0]);
      const before = line.slice(cursor, match.index).trim();
      if (before) {
        segments.push({ type: 'text', value: before });
      }
      segments.push({ type: 'url', value: url });
      // Resume after the URL itself — any stripped trailing punctuation stays
      // as prose for the next slice.
      cursor = match.index + url.length;
      URL_RUN.lastIndex = cursor;
    }
    const after = line.slice(cursor).trim();
    if (after) {
      segments.push({ type: 'text', value: after });
    }
  }
  flush();
  return segments;
}
