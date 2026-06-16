/**
 * `DiscoveredFeature` lives in its own dependency-free leaf module on purpose.
 *
 * Program configs reference these enum values at module-init time (e.g.
 * `promotable: { feature: DiscoveredFeature.Stripe }` in a program's
 * `index.ts`). If the enum were defined in `wizard-session.ts` — which sits
 * inside the import graph that the program registry pulls in — those
 * init-time references could resolve to `undefined` mid-cycle under bundlers
 * or test transforms that don't erase `import type`. A leaf module with zero
 * imports is always fully initialized the instant it's imported, so the value
 * can never be observed half-built.
 *
 * `wizard-session.ts` re-exports this enum, so existing
 * `import { DiscoveredFeature } from '@lib/wizard-session'` consumers keep
 * working. New code that references it at module-init (program configs) should
 * import it from here directly to stay clear of the cycle.
 */

/** A signal the `detect` step found, marking the project a fit for a program. */
export enum DiscoveredFeature {
  Stripe = 'stripe',
  LLM = 'llm',
}
