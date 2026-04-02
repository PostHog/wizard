/**
 * Hardcoded fallback Stripe code examples for each language.
 * Used when runtime fetching from Stripe's docs site fails.
 *
 * These examples are sourced from Stripe's official API docs and
 * the PostHog revenue analytics documentation.
 */

import type { Language, StripeDocsForLanguage } from './types';

export const STRIPE_DOCS_FALLBACK: Record<Language, StripeDocsForLanguage> = {
  node: {
    customerCreate: {
      pattern: 'stripe.customers.create({ ... })',
      metadataExample:
        'metadata: { posthog_person_distinct_id: user.posthogDistinctId }',
      fullExample: `const customer = await stripe.customers.create({
  email: user.email,
  metadata: { posthog_person_distinct_id: user.posthogDistinctId },
});`,
    },
    customerUpdate: {
      pattern: 'stripe.customers.update(customerId, { ... })',
      metadataExample:
        '{ metadata: { posthog_person_distinct_id: user.posthogDistinctId } }',
      fullExample: `await stripe.customers.update(
  user.stripeCustomerId,
  { metadata: { posthog_person_distinct_id: user.posthogDistinctId } }
);`,
    },
  },

  python: {
    customerCreate: {
      pattern: 'stripe.Customer.create(...)',
      metadataExample:
        'metadata={"posthog_person_distinct_id": user.posthog_distinct_id}',
      fullExample: `customer = stripe.Customer.create(
    email=user.email,
    metadata={"posthog_person_distinct_id": user.posthog_distinct_id},
)`,
    },
    customerUpdate: {
      pattern: 'stripe.Customer.modify(customer_id, ...)',
      metadataExample:
        'metadata={"posthog_person_distinct_id": user.posthog_distinct_id}',
      fullExample: `stripe.Customer.modify(
    user.stripe_customer_id,
    metadata={"posthog_person_distinct_id": user.posthog_distinct_id},
)`,
    },
  },

  ruby: {
    customerCreate: {
      pattern: 'Stripe::Customer.create({ ... })',
      metadataExample:
        'metadata: { posthog_person_distinct_id: user.posthog_distinct_id }',
      fullExample: `customer = Stripe::Customer.create({
  email: user.email,
  metadata: { posthog_person_distinct_id: user.posthog_distinct_id },
})`,
    },
    customerUpdate: {
      pattern: 'Stripe::Customer.update(customer_id, { ... })',
      metadataExample:
        '{ metadata: { posthog_person_distinct_id: user.posthog_distinct_id } }',
      fullExample: `Stripe::Customer.update(
  user.stripe_customer_id,
  { metadata: { posthog_person_distinct_id: user.posthog_distinct_id } }
)`,
    },
  },

  php: {
    customerCreate: {
      pattern: '$stripe->customers->create([...])',
      metadataExample:
        "'metadata' => ['posthog_person_distinct_id' => $user->posthogDistinctId]",
      fullExample: `$customer = $stripe->customers->create([
    'email' => $user->email,
    'metadata' => ['posthog_person_distinct_id' => $user->posthogDistinctId],
]);`,
    },
    customerUpdate: {
      pattern: '$stripe->customers->update($customerId, [...])',
      metadataExample:
        "['metadata' => ['posthog_person_distinct_id' => $user->posthogDistinctId]]",
      fullExample: `$stripe->customers->update(
    $user->stripeCustomerId,
    ['metadata' => ['posthog_person_distinct_id' => $user->posthogDistinctId]]
);`,
    },
  },

  go: {
    customerCreate: {
      pattern: 'customer.New(params)',
      metadataExample:
        'params.AddMetadata("posthog_person_distinct_id", user.PosthogDistinctID)',
      fullExample: `params := &stripe.CustomerParams{
    Email: stripe.String(user.Email),
}
params.AddMetadata("posthog_person_distinct_id", user.PosthogDistinctID)
cust, err := customer.New(params)`,
    },
    customerUpdate: {
      pattern: 'customer.Update(customerId, params)',
      metadataExample:
        'params.AddMetadata("posthog_person_distinct_id", user.PosthogDistinctID)',
      fullExample: `params := &stripe.CustomerParams{}
params.AddMetadata("posthog_person_distinct_id", user.PosthogDistinctID)
_, err := customer.Update(user.StripeCustomerID, params)`,
    },
  },

  java: {
    customerCreate: {
      pattern: 'Customer.create(params)',
      metadataExample:
        '.putMetadata("posthog_person_distinct_id", user.getPosthogDistinctId())',
      fullExample: `CustomerCreateParams params = CustomerCreateParams.builder()
    .setEmail(user.getEmail())
    .putMetadata("posthog_person_distinct_id", user.getPosthogDistinctId())
    .build();
Customer customer = Customer.create(params);`,
    },
    customerUpdate: {
      pattern: 'Customer.retrieve(customerId).update(params)',
      metadataExample:
        '.putMetadata("posthog_person_distinct_id", user.getPosthogDistinctId())',
      fullExample: `CustomerUpdateParams params = CustomerUpdateParams.builder()
    .putMetadata("posthog_person_distinct_id", user.getPosthogDistinctId())
    .build();
Customer.retrieve(user.getStripeCustomerId()).update(params);`,
    },
  },

  dotnet: {
    customerCreate: {
      pattern: 'customerService.CreateAsync(options)',
      metadataExample: `Metadata = new Dictionary<string, string>
{
    { "posthog_person_distinct_id", user.PosthogDistinctId },
}`,
      fullExample: `var options = new CustomerCreateOptions
{
    Email = user.Email,
    Metadata = new Dictionary<string, string>
    {
        { "posthog_person_distinct_id", user.PosthogDistinctId },
    },
};
var customer = await customerService.CreateAsync(options);`,
    },
    customerUpdate: {
      pattern: 'customerService.UpdateAsync(customerId, options)',
      metadataExample: `Metadata = new Dictionary<string, string>
{
    { "posthog_person_distinct_id", user.PosthogDistinctId },
}`,
      fullExample: `var options = new CustomerUpdateOptions
{
    Metadata = new Dictionary<string, string>
    {
        { "posthog_person_distinct_id", user.PosthogDistinctId },
    },
};
await customerService.UpdateAsync(user.StripeCustomerId, options);`,
    },
  },
};
