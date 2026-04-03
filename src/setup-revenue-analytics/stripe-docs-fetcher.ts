/**
 * Runtime Stripe docs fetcher — retrieves code examples from Stripe's API docs.
 *
 * Fetches from known, stable Stripe docs URLs and extracts language-specific
 * code examples. Falls back to hardcoded examples if fetching fails.
 */

import { logToFile } from '../utils/debug';
import type { Language, StripeDocsForLanguage } from './types';
import { STRIPE_DOCS_FALLBACK } from './stripe-docs-fallback';

const STRIPE_DOCS_URLS = {
  customerCreate: 'https://docs.stripe.com/api/customers/create',
  customerUpdate: 'https://docs.stripe.com/api/customers/update',
};

const LANGUAGE_TO_STRIPE_TAB: Record<Language, string> = {
  node: 'node',
  python: 'python',
  ruby: 'ruby',
  php: 'php',
  go: 'go',
  java: 'java',
  dotnet: 'dotnet',
};

/**
 * Extract code blocks for a specific language from Stripe's API docs HTML.
 *
 * Stripe docs use a structured format where code examples are wrapped in
 * elements with language-specific identifiers.
 */
function extractCodeBlock(html: string, language: Language): string | null {
  const tab = LANGUAGE_TO_STRIPE_TAB[language];

  // Stripe docs use `data-language="node"` (or similar) attributes on code blocks.
  // Try multiple patterns to be resilient to minor HTML changes.
  const patterns = [
    // Pattern: <pre><code class="language-{tab}">...</code></pre>
    new RegExp(
      `<code[^>]*class="[^"]*language-${tab}[^"]*"[^>]*>([\\s\\S]*?)</code>`,
      'i',
    ),
    // Pattern: data-language="{tab}" attribute
    new RegExp(
      `data-language="${tab}"[^>]*>[\\s\\S]*?<code[^>]*>([\\s\\S]*?)</code>`,
      'i',
    ),
    // Pattern: id containing the language name within a code section
    new RegExp(
      `id="[^"]*${tab}[^"]*"[^>]*>[\\s\\S]*?<code[^>]*>([\\s\\S]*?)</code>`,
      'i',
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1].trim());
    }
  }

  return null;
}

function decodeHtmlEntities(text: string): string {
  // Loop tag stripping until stable — a single pass misses tags
  // reconstructed from nested fragments (e.g. <scr<script>ipt>).
  let stripped = text;
  let prev: string;
  do {
    prev = stripped;
    stripped = stripped.replace(/<[^>]+>/g, '');
  } while (stripped !== prev);

  return stripped
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PostHog-Wizard/1.0',
        Accept: 'text/html',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logToFile(
        `[stripe-docs-fetcher] fetch failed: ${url} status=${response.status}`,
      );
      return null;
    }

    return await response.text();
  } catch (error) {
    logToFile(
      `[stripe-docs-fetcher] fetch error: ${url} error=${String(error)}`,
    );
    return null;
  }
}

/**
 * Fetch Stripe docs for a specific language at runtime.
 * Returns null if fetching or parsing fails.
 */
export async function fetchStripeDocs(
  language: Language,
): Promise<StripeDocsForLanguage | null> {
  const [createHtml, updateHtml] = await Promise.all([
    fetchPage(STRIPE_DOCS_URLS.customerCreate),
    fetchPage(STRIPE_DOCS_URLS.customerUpdate),
  ]);

  if (!createHtml || !updateHtml) {
    logToFile('[stripe-docs-fetcher] failed to fetch one or more pages');
    return null;
  }

  const createCode = extractCodeBlock(createHtml, language);
  const updateCode = extractCodeBlock(updateHtml, language);

  if (!createCode || !updateCode) {
    logToFile(
      `[stripe-docs-fetcher] could not extract code for language=${language}`,
    );
    return null;
  }

  // We have the raw code examples from Stripe. Build our structured format.
  // The fetched examples are the "full example" — the pattern and metadata
  // example come from our fallback (they're stable across versions).
  const fallback = STRIPE_DOCS_FALLBACK[language];

  return {
    customerCreate: {
      pattern: fallback.customerCreate.pattern,
      metadataExample: fallback.customerCreate.metadataExample,
      fullExample: createCode,
    },
    customerUpdate: {
      pattern: fallback.customerUpdate.pattern,
      metadataExample: fallback.customerUpdate.metadataExample,
      fullExample: updateCode,
    },
  };
}
