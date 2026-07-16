/**
 * Link-rendering helpers for terminal prompts.
 *
 * Terminals auto-linkify by scanning *visual* lines, so a wrapped URL gets a
 * broken click target. The fix is an explicit OSC 8 hyperlink, which carries
 * the exact target out of band, independent of layout. To keep the escape
 * intact we render each URL on its own line with a label short enough not to
 * wrap (see `LinkText`, `wrap="truncate"`). Terminals without OSC 8 support
 * ignore the escape and show the visible text.
 */

// OSC 8 hyperlink escape: ESC ] 8 ; ; <url> BEL <label> ESC ] 8 ; ; BEL.
// Built from char codes so no raw control bytes live in source.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const OSC_8 = `${ESC}]8;;`;

const ELLIPSIS = '…';

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
 *
 * Optional `id` groups runs of a link split across lines so they highlight as
 * one; a link that fits on one line doesn't need it.
 */
export function osc8Hyperlink(
  url: string,
  label: string = url,
  id?: string,
): string {
  const open = `${ESC}]8;${id ? `id=${id}` : ''};${url}${BEL}`;
  return `${open}${label}${OSC_8}${BEL}`;
}

/**
 * Shorten a URL for *display only*, always keeping `scheme://host` intact (the
 * trust signal) and collapsing the noisy path/query tail to an ellipsis.
 *
 * Purely the visible label — callers pair it with `osc8Hyperlink(url, label)`
 * so the click target and copy/open keybinds stay the full URL. Returns the URL
 * unchanged when it already fits within `maxLength`.
 */
export function truncateUrlLabel(url: string, maxLength = 56): string {
  if (url.length <= maxLength) return url;

  let head: string;
  let tail: string;
  try {
    const parsed = new URL(url);
    head = `${parsed.protocol}//${parsed.host}`;
    tail = url.slice(head.length);
  } catch {
    // Not parseable as a URL: fall back to a plain head truncation.
    return url.slice(0, Math.max(1, maxLength - ELLIPSIS.length)) + ELLIPSIS;
  }

  // The host alone already fills (or overflows) the budget: show it whole (it's
  // the trust signal) and ellipsize only if we're actually hiding a tail.
  if (head.length >= maxLength - ELLIPSIS.length) {
    return tail.length > 0 ? head + ELLIPSIS : head;
  }

  // Fill the remaining room with as much of the path/query as fits, then ellipsize.
  const room = maxLength - head.length - ELLIPSIS.length;
  return head + tail.slice(0, room) + ELLIPSIS;
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
 * Split prompt text into renderable segments, breaking every URL (standalone or
 * inline) onto its own `url` segment so `LinkText` can render it as a single
 * OSC 8 hyperlink. URL-free lines stay grouped in one `text` segment (newlines
 * preserved), and prose around an inline URL is kept as `text` before/after it,
 * so the text reads the same apart from the link being on its own line.
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
