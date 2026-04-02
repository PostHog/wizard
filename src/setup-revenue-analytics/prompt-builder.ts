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

Once you know WHAT value is the distinct_id (e.g. \`email\`, \`user.id\`, \`userId\`), determine HOW to access that same value at each Stripe call site. The variable name may differ between files — trace the data flow. For example:
- Frontend calls \`posthog.identify(email)\` → backend receives email as a parameter → use that parameter at the Stripe call site
- If the value isn't directly available, you may need to pass it through or look it up

Do NOT invent properties like \`user.posthogDistinctId\` — this field does not exist. Use the actual value from the codebase.

## Instructions

Follow these steps IN ORDER:

### STEP 1: Update Stripe Customer Creation

For each Stripe Customer.create call, add \`posthog_person_distinct_id\` to the metadata.

**API pattern (replace \`<POSTHOG_DISTINCT_ID>\` with the actual value):**
\`\`\`
${stripeDocs.customerCreate.fullExample}
\`\`\`

Rules:
- Replace \`<POSTHOG_DISTINCT_ID>\` with the actual distinct_id expression available at this call site.
- If the call already has a metadata object, ADD the \`posthog_person_distinct_id\` key to it. Do NOT overwrite existing metadata.
- If the call does not have a metadata object, add one.
- Preserve all existing arguments and code structure.

### STEP 2: Add Customer Update Before Charges

For each charge/payment call (PaymentIntent.create, Subscription.create, Invoice.create, checkout.Session.create), add a Stripe Customer.update/modify call BEFORE the charge.

**API pattern (replace \`<POSTHOG_DISTINCT_ID>\` with the actual value):**
\`\`\`
${stripeDocs.customerUpdate.fullExample}
\`\`\`

Rules:
- Replace \`<POSTHOG_DISTINCT_ID>\` with the actual distinct_id expression available at this call site.
- Add the update call immediately before the charge call.
- Extract the customer ID from the charge call's arguments (it's usually a \`customer\` field).
- The update only sets metadata — do not modify the charge/payment logic itself.
- If the customer ID is not available at that point, trace back to find it.
${checkoutNote}

### STEP 3: Verify

After making all changes, read each modified file to verify:
- No syntax errors
- Existing code logic is preserved
- The metadata field uses the correct distinct_id value (NOT a made-up property)
- Imports are present if needed

## Constraints

- Do NOT modify the charge/payment logic itself — only add metadata to customer creation and add customer.update calls before charges.
- Do NOT remove any existing code.
- Do NOT add new packages or dependencies.
- Do NOT invent new properties or fields. Use only values that already exist in the codebase.
- Preserve all imports and error handling.
- If you truly cannot determine the distinct_id after searching, use \`"TODO_POSTHOG_DISTINCT_ID"\` as a string placeholder.

When done, emit: ${
    AgentSignals.STATUS
  } Revenue analytics setup complete — modified files summary.
`;
}
