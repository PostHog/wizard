import { getStripeDocs, clearStripeDocsCache } from '../stripe-docs';
import { STRIPE_DOCS_FALLBACK } from '../stripe-docs-fallback';
import type { Language } from '../types';

// Mock the fetcher to avoid real HTTP calls in tests
jest.mock('../stripe-docs-fetcher', () => ({
  fetchStripeDocs: jest.fn().mockResolvedValue(null),
}));

describe('getStripeDocs', () => {
  beforeEach(() => {
    clearStripeDocsCache();
  });

  test('returns fallback docs when fetcher returns null', async () => {
    const docs = await getStripeDocs('node');
    expect(docs).toEqual(STRIPE_DOCS_FALLBACK.node);
  });

  test('caches results across calls', async () => {
    const docs1 = await getStripeDocs('python');
    const docs2 = await getStripeDocs('python');
    expect(docs1).toBe(docs2); // Same reference
  });

  test.each(['node', 'python', 'ruby', 'php', 'go', 'java', 'dotnet'] as const)(
    'returns docs for %s',
    async (language: Language) => {
      const docs = await getStripeDocs(language);
      expect(docs.customerCreate).toBeDefined();
      expect(docs.customerCreate.pattern).toBeTruthy();
      expect(docs.customerCreate.metadataExample).toContain(
        'posthog_person_distinct_id',
      );
      expect(docs.customerUpdate).toBeDefined();
      expect(docs.customerUpdate.pattern).toBeTruthy();
      expect(docs.customerUpdate.metadataExample).toContain(
        'posthog_person_distinct_id',
      );
    },
  );
});

describe('STRIPE_DOCS_FALLBACK', () => {
  test.each(['node', 'python', 'ruby', 'php', 'go', 'java', 'dotnet'] as const)(
    '%s has complete customer create and update examples',
    (language: Language) => {
      const docs = STRIPE_DOCS_FALLBACK[language];
      expect(docs.customerCreate.fullExample).toBeTruthy();
      expect(docs.customerCreate.fullExample).toContain(
        'posthog_person_distinct_id',
      );
      expect(docs.customerUpdate.fullExample).toBeTruthy();
      expect(docs.customerUpdate.fullExample).toContain(
        'posthog_person_distinct_id',
      );
    },
  );
});
