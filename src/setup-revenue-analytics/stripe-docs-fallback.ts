/**
 * Hardcoded fallback Stripe code examples for each language.
 * Used when runtime fetching from Stripe's docs site fails.
 *
 * IMPORTANT: Examples use <POSTHOG_DISTINCT_ID> as a placeholder.
 * The prompt instructs the agent to replace this with the actual
 * distinct_id expression found in the codebase (e.g. the value
 * passed to posthog.identify()).
 */

import type { Language, StripeDocsForLanguage } from './types';

export const STRIPE_DOCS_FALLBACK: Record<Language, StripeDocsForLanguage> = {
  node: {
    customerCreate: {
      pattern: 'stripe.customers.create({ ... })',
      metadataExample:
        'metadata: { posthog_person_distinct_id: <POSTHOG_DISTINCT_ID> }',
      fullExample: `const customer = await stripe.customers.create({
  email: user.email,
  metadata: { posthog_person_distinct_id: <POSTHOG_DISTINCT_ID> },
});`,
    },
    customerUpdate: {
      pattern: 'stripe.customers.update(customerId, { ... })',
      metadataExample:
        '{ metadata: { posthog_person_distinct_id: <POSTHOG_DISTINCT_ID> } }',
      fullExample: `await stripe.customers.update(
  customerId,
  { metadata: { posthog_person_distinct_id: <POSTHOG_DISTINCT_ID> } }
);`,
    },
  },

  python: {
    customerCreate: {
      pattern: 'stripe.Customer.create(...)',
      metadataExample:
        'metadata={"posthog_person_distinct_id": <POSTHOG_DISTINCT_ID>}',
      fullExample: `customer = stripe.Customer.create(
    email=user.email,
    metadata={"posthog_person_distinct_id": <POSTHOG_DISTINCT_ID>},
)`,
    },
    customerUpdate: {
      pattern: 'stripe.Customer.modify(customer_id, ...)',
      metadataExample:
        'metadata={"posthog_person_distinct_id": <POSTHOG_DISTINCT_ID>}',
      fullExample: `stripe.Customer.modify(
    customer_id,
    metadata={"posthog_person_distinct_id": <POSTHOG_DISTINCT_ID>},
)`,
    },
  },

  ruby: {
    customerCreate: {
      pattern: 'Stripe::Customer.create({ ... })',
      metadataExample:
        'metadata: { posthog_person_distinct_id: <POSTHOG_DISTINCT_ID> }',
      fullExample: `customer = Stripe::Customer.create({
  email: user.email,
  metadata: { posthog_person_distinct_id: <POSTHOG_DISTINCT_ID> },
})`,
    },
    customerUpdate: {
      pattern: 'Stripe::Customer.update(customer_id, { ... })',
      metadataExample:
        '{ metadata: { posthog_person_distinct_id: <POSTHOG_DISTINCT_ID> } }',
      fullExample: `Stripe::Customer.update(
  customer_id,
  { metadata: { posthog_person_distinct_id: <POSTHOG_DISTINCT_ID> } }
)`,
    },
  },

  php: {
    customerCreate: {
      pattern: '$stripe->customers->create([...])',
      metadataExample:
        "'metadata' => ['posthog_person_distinct_id' => <POSTHOG_DISTINCT_ID>]",
      fullExample: `$customer = $stripe->customers->create([
    'email' => $user->email,
    'metadata' => ['posthog_person_distinct_id' => <POSTHOG_DISTINCT_ID>],
]);`,
    },
    customerUpdate: {
      pattern: '$stripe->customers->update($customerId, [...])',
      metadataExample:
        "['metadata' => ['posthog_person_distinct_id' => <POSTHOG_DISTINCT_ID>]]",
      fullExample: `$stripe->customers->update(
    $customerId,
    ['metadata' => ['posthog_person_distinct_id' => <POSTHOG_DISTINCT_ID>]]
);`,
    },
  },

  go: {
    customerCreate: {
      pattern: 'customer.New(params)',
      metadataExample:
        'params.AddMetadata("posthog_person_distinct_id", <POSTHOG_DISTINCT_ID>)',
      fullExample: `params := &stripe.CustomerParams{
    Email: stripe.String(user.Email),
}
params.AddMetadata("posthog_person_distinct_id", <POSTHOG_DISTINCT_ID>)
cust, err := customer.New(params)`,
    },
    customerUpdate: {
      pattern: 'customer.Update(customerId, params)',
      metadataExample:
        'params.AddMetadata("posthog_person_distinct_id", <POSTHOG_DISTINCT_ID>)',
      fullExample: `params := &stripe.CustomerParams{}
params.AddMetadata("posthog_person_distinct_id", <POSTHOG_DISTINCT_ID>)
_, err := customer.Update(stripeCustomerID, params)`,
    },
  },

  java: {
    customerCreate: {
      pattern: 'Customer.create(params)',
      metadataExample:
        '.putMetadata("posthog_person_distinct_id", <POSTHOG_DISTINCT_ID>)',
      fullExample: `CustomerCreateParams params = CustomerCreateParams.builder()
    .setEmail(user.getEmail())
    .putMetadata("posthog_person_distinct_id", <POSTHOG_DISTINCT_ID>)
    .build();
Customer customer = Customer.create(params);`,
    },
    customerUpdate: {
      pattern: 'Customer.retrieve(customerId).update(params)',
      metadataExample:
        '.putMetadata("posthog_person_distinct_id", <POSTHOG_DISTINCT_ID>)',
      fullExample: `CustomerUpdateParams params = CustomerUpdateParams.builder()
    .putMetadata("posthog_person_distinct_id", <POSTHOG_DISTINCT_ID>)
    .build();
Customer.retrieve(stripeCustomerId).update(params);`,
    },
  },

  dotnet: {
    customerCreate: {
      pattern: 'customerService.CreateAsync(options)',
      metadataExample: `Metadata = new Dictionary<string, string>
{
    { "posthog_person_distinct_id", <POSTHOG_DISTINCT_ID> },
}`,
      fullExample: `var options = new CustomerCreateOptions
{
    Email = user.Email,
    Metadata = new Dictionary<string, string>
    {
        { "posthog_person_distinct_id", <POSTHOG_DISTINCT_ID> },
    },
};
var customer = await customerService.CreateAsync(options);`,
    },
    customerUpdate: {
      pattern: 'customerService.UpdateAsync(customerId, options)',
      metadataExample: `Metadata = new Dictionary<string, string>
{
    { "posthog_person_distinct_id", <POSTHOG_DISTINCT_ID> },
}`,
      fullExample: `var options = new CustomerUpdateOptions
{
    Metadata = new Dictionary<string, string>
    {
        { "posthog_person_distinct_id", <POSTHOG_DISTINCT_ID> },
    },
};
await customerService.UpdateAsync(stripeCustomerId, options);`,
    },
  },
};
