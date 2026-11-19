/** Script hosts in templates: which catalog hosts a template's `<script>` elements load from. */

/**
 * A walk matches script hosts in at most this many templates with a `<script`
 * tag, and skips any larger than {@link MAX_TEMPLATE_BYTES}.
 */
export const MAX_TEMPLATE_FILES = 300;
export const MAX_TEMPLATE_BYTES = 512 * 1024;

const TEMPLATE_SUFFIXES = [
  '.html',
  '.htm',
  '.erb',
  '.ejs',
  '.hbs',
  '.jinja',
  '.j2',
  '.twig',
  '.blade.php',
  '.heex',
  '.liquid',
  '.vue',
  '.svelte',
  '.astro',
  '.jsx',
  '.tsx',
];

export function isTemplateFileName(name: string): boolean {
  return TEMPLATE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function hostMatches(host: string, catalogHost: string): boolean {
  return host === catalogHost || host.endsWith(`.${catalogHost}`);
}

// Protocol-relative or absolute URLs, as written in `src` attributes and in
// inline loader snippets that build the script URL in a string.
const URL_HOST = /(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;

/**
 * The text of each `<script>` element in a template: its attributes and its
 * inline body. Case-insensitive, so a Next.js `<Script>` counts. A plain
 * scan with `indexOf`, so a template full of unclosed tags stays linear.
 */
function scriptElements(content: string): string[] {
  const lower = content.toLowerCase();
  const elements: string[] = [];
  let from = 0;
  for (;;) {
    const start = lower.indexOf('<script', from);
    if (start === -1) return elements;
    const after = lower.charAt(start + '<script'.length);
    if (after !== '' && !/[\s>/]/.test(after)) {
      from = start + 1;
      continue;
    }
    const tagEnd = endOfTag(content, start);
    let end = tagEnd;
    // A self-closing `<Script ... />` has no body.
    if (content.charAt(tagEnd - 1) !== '/') {
      const close = lower.indexOf('</script', tagEnd);
      end = close === -1 ? content.length : close;
    }
    elements.push(content.slice(start, end));
    if (end >= content.length) return elements;
    from = end + 1;
  }
}

/**
 * The index of the `>` that closes the tag opened at `start`, or the end of
 * the content. Skips a `>` inside a quoted value or a JSX `{...}` expression,
 * such as an arrow function in a `<Script onLoad={() => ...}>` prop.
 */
function endOfTag(content: string, start: number): number {
  let quote: string | null = null;
  let braces = 0;
  for (let i = start; i < content.length; i += 1) {
    const char = content[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      braces += 1;
    } else if (char === '}') {
      braces = Math.max(0, braces - 1);
    } else if (char === '>' && braces === 0) {
      return i;
    }
  }
  return content.length;
}

/**
 * The catalog script hosts a template loads from. Only `<script>` elements
 * count: a URL in a link or in text loads nothing. A hostname is kept as the
 * catalog host it matched, never as written, so a customer subdomain such as
 * `acme.zendesk.com` never leaves the machine. Every other hostname is dropped
 * as soon as it is read.
 */
export function catalogHostsIn(
  content: string,
  catalogHosts: readonly string[],
): string[] {
  const found = new Set<string>();
  for (const element of scriptElements(content)) {
    for (const match of element.matchAll(URL_HOST)) {
      const host = match[1].toLowerCase();
      for (const catalogHost of catalogHosts) {
        if (hostMatches(host, catalogHost)) found.add(catalogHost);
      }
    }
  }
  return [...found];
}

/** Whether a template has a `<script` tag at all; one without counts against no budget. */
export function hasScriptTag(content: string): boolean {
  return /<script\b/i.test(content);
}
