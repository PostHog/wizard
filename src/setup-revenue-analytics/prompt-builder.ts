/**
 * Build the agent prompt for revenue analytics setup.
 *
 * Assembles all detected context (language, Stripe calls, PostHog distinct_id,
 * Stripe docs) into a structured prompt the agent can follow step-by-step.
 */

import { AgentSignals } from '../lib/agent-interface';
import type {
  Language,
  StripeDetectionResult,
  PostHogDistinctIdResult,
  StripeDocsForLanguage,
} from './types';

interface PromptContext {
  language: Language;
  stripeDetection: StripeDetectionResult;
  posthogDetection: PostHogDistinctIdResult;
  stripeDocs: StripeDocsForLanguage;
}

export function buildRevenueAnalyticsPrompt(context: PromptContext): string {
  const { language, stripeDetection, posthogDetection, stripeDocs } = context;

  const distinctIdSection = posthogDetection.distinctIdExpression
    ? `- PostHog distinct_id: \`${posthogDetection.distinctIdExpression}\` (found in ${posthogDetection.sourceFile}: \`${posthogDetection.sourceLine}\`)`
    : `- PostHog distinct_id: **Not automatically detected**.`;

  const customerCreationSection =
    stripeDetection.customerCreationCalls.length > 0
      ? stripeDetection.customerCreationCalls
          .map((c) => `  - ${c.file}:${c.line} — \`${c.snippet}\``)
          .join('\n')
      : '  (none found — search the codebase yourself)';

  const chargeSection =
    stripeDetection.chargeCalls.length > 0
      ? stripeDetection.chargeCalls
          .map((c) => `  - ${c.file}:${c.line} [${c.type}] — \`${c.snippet}\``)
          .join('\n')
      : '  (none found — search the codebase yourself)';

  const checkoutNote = stripeDetection.usesCheckoutSessions
    ? `
IMPORTANT — Stripe Checkout detected:
This project uses checkout.Session.create, which means Stripe may auto-create customers.
If there is no explicit Customer.create call, you need to handle this in the checkout.session.completed webhook handler instead.
In the webhook handler, after receiving the session object, update the customer with the PostHog metadata.

Tip: Set client_reference_id to the internal user ID when creating Checkout Sessions. This lets you look up the user in your database when the webhook fires.`
    : '';

  return `You are setting up PostHog revenue analytics for a ${language} project that uses Stripe.

Your goal: Modify the codebase so that every Stripe customer has a \`posthog_person_distinct_id\` metadata field. This connects Stripe revenue data to PostHog persons.

## Guiding Tenets

Follow these tenets for every decision you make:

1. **Never fabricate the value.** If the PostHog distinct_id is not available in the current scope, do NOT substitute another identifier (Stripe customer ID, internal user ID, org ID, etc.). A wrong value is worse than no value — it corrupts metadata and blocks correct identification downstream.

2. **Thread the value, don't invent it.** If a function needs the distinct_id but doesn't have it, add it as an optional parameter propagated from a caller that does. If no caller in the chain has it, skip that call site entirely and leave a TODO comment.

3. **Minimize extra API calls.** Each \`stripe.Customer.modify\` / \`stripe.customers.update\` is a network round-trip with rate-limit cost. Don't add one before every payment intent, subscription, or invoice creation. If multiple charge calls share the same customer in a single flow, update once at the top, not before each call.

4. **Follow existing Stripe abstraction patterns.** If the codebase wraps Stripe calls behind a utility/service layer, modify that layer. Don't call the Stripe API directly from business logic just to set metadata.

## Context

- Language: ${language}
- Stripe SDK: ${stripeDetection.sdkPackage}${
    stripeDetection.sdkVersion ? ` v${stripeDetection.sdkVersion}` : ''
  }
${distinctIdSection}

### Customer creation locations:
${customerCreationSection}

### Charge/payment locations:
${chargeSection}

## CRITICAL FIRST STEP: Determine the PostHog distinct_id value

Before writing ANY code, you must determine what this project uses as the PostHog distinct_id. This is the value that must go into \`posthog_person_distinct_id\` metadata on Stripe customers.

${
  posthogDetection.distinctIdExpression
    ? `The pre-scan detected \`${posthogDetection.distinctIdExpression}\` (from \`${posthogDetection.sourceLine}\`). Verify this is correct by reading the file, then determine how to access the same value at each Stripe call site.`
    : `Search the codebase for how the distinct_id is set.`
}

How to find it:
1. Search for \`posthog.identify(\` — the FIRST ARGUMENT is the distinct_id. This is the most reliable source.
   Example: \`posthog.identify(email, { ... })\` → the distinct_id is \`email\`
   Example: \`posthog.identify(user.id, { ... })\` → the distinct_id is \`user.id\`
2. Search for \`posthog.capture(\` or \`client.capture(\` — look for \`distinctId\` or \`distinct_id\` in the arguments.
3. Search for \`posthog.get_distinct_id()\` — the variable it's assigned to tells you what holds the distinct_id.

Once you know WHAT value is the distinct_id (e.g. \`email\`, \`user.id\`, \`userId\`), determine HOW to access that same value at each Stripe call site. The variable name may differ between files — trace the data flow.

If the distinct_id is not available at a Stripe call site, apply Tenet 2: add it as an optional parameter from a caller that has it. If no caller has it, skip that site and add a TODO.

Once determined, emit: ${
    AgentSignals.STATUS
  } Identified distinct_id — updating Stripe customer creation...

## Instructions

Follow these steps IN ORDER. Emit a \`${
    AgentSignals.STATUS
  }\` message at the start of each step so the user can see progress.

### STEP 1: Update Stripe Customer Creation

For each Stripe Customer.create call, add \`posthog_person_distinct_id\` to the metadata.

Before modifying: check if the codebase wraps Stripe calls behind a utility or service layer. If so, modify that layer — don't add direct API calls in business logic (Tenet 4).

**API pattern (replace \`<POSTHOG_DISTINCT_ID>\` with the actual value):**
\`\`\`
${stripeDocs.customerCreate.fullExample}
\`\`\`

Rules:
- Replace \`<POSTHOG_DISTINCT_ID>\` with the actual distinct_id expression available at this call site.
- If the distinct_id is not in scope, thread it as an optional parameter from the caller (Tenet 2). If no caller has it, skip this site and add \`// TODO: pass PostHog distinct_id here\`.
- If the call already has a metadata object, ADD the \`posthog_person_distinct_id\` key to it. Do NOT overwrite existing metadata.
- Preserve all existing arguments and code structure.

After modifying customer creation, emit: ${
    AgentSignals.STATUS
  } Customer creation updated — adding metadata for existing customers...

### STEP 2: Add Customer Update for Existing Customers

This step handles customers created before this setup — they won't have the metadata from Step 1.

Add a \`Customer.update\` / \`Customer.modify\` call to tag existing customers with the PostHog distinct_id. But apply Tenet 3 — minimize API calls:
- Do NOT add an update before every single charge call. Instead, find the earliest point where both the customer ID and the distinct_id are available.
- If multiple charge calls share the same customer in a single function or flow, update once at the top.
- If the codebase already has a "get or ensure customer" pattern, add the metadata there.

**API pattern (replace \`<POSTHOG_DISTINCT_ID>\` with the actual value):**
\`\`\`
${stripeDocs.customerUpdate.fullExample}
\`\`\`

Rules:
- Same as Step 1: if the distinct_id is not in scope, thread it or skip with a TODO (Tenet 2). Never substitute a different identifier (Tenet 1).
- Respect existing Stripe abstraction layers (Tenet 4).
${checkoutNote}

After modifying existing customer handling, emit: ${
    AgentSignals.STATUS
  } Verifying changes...

### STEP 3: Verify

After making all changes, read each modified file to verify:
- No syntax errors
- Existing code logic is preserved
- The metadata field uses the correct distinct_id value — not a fabricated property
- No unnecessary duplicate API calls (Tenet 3)
- Changes respect existing abstraction patterns (Tenet 4)
- Imports are present if needed

## Constraints

- **Never fabricate.** Do not invent properties or values. \`user.posthogDistinctId\` does not exist — use only values from the codebase.
- **Thread, don't invent.** If the distinct_id isn't in scope, propagate it as a parameter. If impossible, skip the site with a TODO.
- **Minimize API calls.** Don't add a Customer.modify before every charge — deduplicate.
- **Respect abstractions.** If the codebase wraps Stripe, modify the wrapper.
- Do NOT modify charge/payment logic — only add metadata to customer creation and customer update calls.
- Do NOT remove any existing code.
- Do NOT add new packages or dependencies.
- Preserve all imports and error handling.

When done, emit: ${
    AgentSignals.STATUS
  } Revenue analytics setup complete — modified files summary.
`;
}
