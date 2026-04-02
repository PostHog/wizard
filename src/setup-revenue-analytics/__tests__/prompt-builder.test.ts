import { buildRevenueAnalyticsPrompt } from '../prompt-builder';
import type { StripeDetectionResult, PostHogDistinctIdResult } from '../types';
import { STRIPE_DOCS_FALLBACK } from '../stripe-docs-fallback';

function makeContext(overrides?: {
  language?: StripeDetectionResult['language'];
  customerCalls?: StripeDetectionResult['customerCreationCalls'];
  chargeCalls?: StripeDetectionResult['chargeCalls'];
  distinctId?: string | null;
  usesCheckout?: boolean;
}) {
  const language = overrides?.language ?? 'node';
  return {
    language,
    stripeDetection: {
      sdkPackage: 'package.json',
      sdkVersion: '14.21.0',
      language,
      customerCreationCalls: overrides?.customerCalls ?? [
        {
          file: 'src/billing.ts',
          line: 10,
          snippet: 'stripe.customers.create({',
        },
      ],
      chargeCalls: overrides?.chargeCalls ?? [
        {
          file: 'src/payments.ts',
          line: 20,
          snippet: 'stripe.paymentIntents.create({',
          type: 'payment_intent' as const,
        },
      ],
      usesCheckoutSessions: overrides?.usesCheckout ?? false,
    } satisfies StripeDetectionResult,
    posthogDetection: {
      distinctIdExpression:
        overrides && 'distinctId' in overrides
          ? overrides.distinctId ?? null
          : 'user.id',
      sourceFile: overrides?.distinctId === null ? null : 'src/analytics.ts',
      sourceLine:
        overrides?.distinctId === null ? null : 'posthog.identify(user.id)',
    } satisfies PostHogDistinctIdResult,
    stripeDocs: STRIPE_DOCS_FALLBACK[language],
  };
}

describe('buildRevenueAnalyticsPrompt', () => {
  test('includes language and Stripe SDK info', () => {
    const prompt = buildRevenueAnalyticsPrompt(makeContext());
    expect(prompt).toContain('node');
    expect(prompt).toContain('v14.21.0');
  });

  test('includes detected distinct_id expression and source line', () => {
    const prompt = buildRevenueAnalyticsPrompt(makeContext());
    expect(prompt).toContain('`user.id`');
    expect(prompt).toContain('src/analytics.ts');
    expect(prompt).toContain('posthog.identify(user.id)');
  });

  test('instructs agent to search codebase when distinct_id not detected', () => {
    const prompt = buildRevenueAnalyticsPrompt(
      makeContext({ distinctId: null }),
    );
    expect(prompt).toContain('Not automatically detected');
    expect(prompt).toContain('Search the codebase');
  });

  test('explains how to find distinct_id from posthog.identify', () => {
    const prompt = buildRevenueAnalyticsPrompt(makeContext());
    expect(prompt).toContain('posthog.identify(');
    expect(prompt).toContain('FIRST ARGUMENT is the distinct_id');
  });

  test('warns not to invent properties', () => {
    const prompt = buildRevenueAnalyticsPrompt(makeContext());
    expect(prompt).toContain('Do NOT invent');
    expect(prompt).toContain('user.posthogDistinctId');
  });

  test('uses <POSTHOG_DISTINCT_ID> placeholder in code examples', () => {
    const prompt = buildRevenueAnalyticsPrompt(makeContext());
    expect(prompt).toContain('<POSTHOG_DISTINCT_ID>');
    expect(prompt).toContain('Replace `<POSTHOG_DISTINCT_ID>` with the actual');
  });

  test('includes customer creation locations', () => {
    const prompt = buildRevenueAnalyticsPrompt(makeContext());
    expect(prompt).toContain('src/billing.ts:10');
  });

  test('includes charge call locations with types', () => {
    const prompt = buildRevenueAnalyticsPrompt(makeContext());
    expect(prompt).toContain('src/payments.ts:20 [payment_intent]');
  });

  test('handles no customer creation calls found', () => {
    const prompt = buildRevenueAnalyticsPrompt(
      makeContext({ customerCalls: [] }),
    );
    expect(prompt).toContain('none found');
    expect(prompt).toContain('search the codebase yourself');
  });

  test('includes checkout session note when detected', () => {
    const prompt = buildRevenueAnalyticsPrompt(
      makeContext({
        usesCheckout: true,
        chargeCalls: [
          {
            file: 'src/checkout.ts',
            line: 5,
            snippet: 'stripe.checkout.sessions.create({',
            type: 'checkout_session',
          },
        ],
      }),
    );
    expect(prompt).toContain('Stripe Checkout detected');
    expect(prompt).toContain('checkout.session.completed webhook');
  });

  test('does not include checkout note when not using checkout', () => {
    const prompt = buildRevenueAnalyticsPrompt(makeContext());
    expect(prompt).not.toContain('Stripe Checkout detected');
  });

  test('includes Stripe docs code examples', () => {
    const prompt = buildRevenueAnalyticsPrompt(makeContext());
    expect(prompt).toContain('stripe.customers.create');
    expect(prompt).toContain('stripe.customers.update');
    expect(prompt).toContain('posthog_person_distinct_id');
  });

  test('includes constraints section', () => {
    const prompt = buildRevenueAnalyticsPrompt(makeContext());
    expect(prompt).toContain('Do NOT modify the charge/payment logic');
    expect(prompt).toContain('Do NOT remove any existing code');
  });

  test.each(['python', 'ruby', 'php', 'go', 'java', 'dotnet'] as const)(
    'generates prompt for %s',
    (language) => {
      const prompt = buildRevenueAnalyticsPrompt(makeContext({ language }));
      expect(prompt).toContain(language);
      expect(prompt).toContain('posthog_person_distinct_id');
    },
  );
});
