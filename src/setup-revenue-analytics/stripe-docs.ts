/**
 * Stripe docs orchestrator — tries runtime fetch, falls back to hardcoded examples.
 * Caches results for the session.
 */

import { logToFile } from '../utils/debug';
import type { Language, StripeDocsForLanguage } from './types';
import { fetchStripeDocs } from './stripe-docs-fetcher';
import { STRIPE_DOCS_FALLBACK } from './stripe-docs-fallback';

const cache = new Map<Language, StripeDocsForLanguage>();

export async function getStripeDocs(
  language: Language,
  _sdkVersion?: string | null,
): Promise<StripeDocsForLanguage> {
  const cached = cache.get(language);
  if (cached) return cached;

  const fetched = await fetchStripeDocs(language);
  if (fetched) {
    logToFile(`[stripe-docs] using fetched docs for ${language}`);
    cache.set(language, fetched);
    return fetched;
  }

  logToFile(`[stripe-docs] using fallback docs for ${language}`);
  const fallback = STRIPE_DOCS_FALLBACK[language];
  cache.set(language, fallback);
  return fallback;
}

/** Clear the cache (for testing). */
export function clearStripeDocsCache(): void {
  cache.clear();
}
