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
    ? `- PostHog distinct_id expression: \`${posthogDetection.distinctIdExpression}\` (found in ${posthogDetection.sourceFile})`
    : `- PostHog distinct_id: **Not automatically detected**. Before making changes, you MUST search the codebase to find how the user is identified. Look for:
  - \`posthog.identify(...)\` calls — the first argument is the distinct_id
  - \`posthog.capture(...)\` calls — look for \`distinctId\` or \`distinct_id\` properties
  - User ID patterns in auth/session code (e.g., \`user.id\`, \`req.user.id\`, \`request.user.pk\`, \`session.userId\`, \`currentUser.id\`)
  If you truly cannot find it, use a clear TODO placeholder: \`"TODO_POSTHOG_DISTINCT_ID"\` so the user can fill it in.`;

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
In the webhook handler, after receiving the session object, update the customer with the PostHog metadata:

${stripeDocs.customerUpdate.fullExample}

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

## Instructions

Follow these steps IN ORDER:

### STEP 1: Update Stripe Customer Creation

For each Stripe Customer.create call, add \`posthog_person_distinct_id\` to the metadata.

**Pattern for this language:**
\`\`\`
${stripeDocs.customerCreate.fullExample}
\`\`\`

Rules:
- If the call already has a metadata object, ADD the \`posthog_person_distinct_id\` key to it. Do NOT overwrite existing metadata.
- If the call does not have a metadata object, add one with the \`posthog_person_distinct_id\` key.
- Use the PostHog distinct_id expression detected above${
    posthogDetection.distinctIdExpression
      ? ` (\`${posthogDetection.distinctIdExpression}\`)`
      : ''
  } as the value. Adapt it to the variable scope at the call site.
- Preserve all existing arguments and code structure.

### STEP 2: Add Customer Update Before Charges

For each charge/payment call (PaymentIntent.create, Subscription.create, Invoice.create, checkout.Session.create), add a Stripe Customer.update/modify call BEFORE the charge. This ensures existing customers (created before Step 1) get tagged.

**Pattern for this language:**
\`\`\`
${stripeDocs.customerUpdate.fullExample}
\`\`\`

Rules:
- Add the update call immediately before the charge call.
- Extract the customer ID from the charge call's arguments (it's usually a \`customer\` field).
- The update only sets metadata — do not modify the charge/payment logic itself.
- If the customer ID is not available at that point, trace back to find it.
${checkoutNote}

### STEP 3: Verify

After making all changes, read each modified file to verify:
- No syntax errors
- Existing code logic is preserved
- The metadata field is correctly set
- Imports are present if needed

## Constraints

- Do NOT modify the charge/payment logic itself — only add metadata to customer creation and add customer.update calls before charges.
- Do NOT remove any existing code.
- Do NOT add new packages or dependencies.
- Preserve all imports and error handling.
- If you cannot determine the distinct_id expression from context, add a \`TODO\` comment: \`// TODO: Replace with your PostHog distinct_id\`

When done, emit: ${
    AgentSignals.STATUS
  } Revenue analytics setup complete — modified files summary.
`;
}
