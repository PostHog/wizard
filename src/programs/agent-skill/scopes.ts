/**
 * Extra scopes the agent-skill program needs on top of `WIZARD_OAUTH_SCOPES`.
 *
 * Skills under this program (e.g. `creating-product-tours`) create feature
 * flags during the install flow. PostHog's consent grants exactly the scope
 * strings requested — `:write` does not imply `:read` — so listing existing
 * flags to avoid key collisions needs `feature_flag:read` explicitly.
 * `property_definition:read` lets the agent discover person properties when
 * building flag rollout filters instead of having to ask the user verbatim.
 */
export const AGENT_SKILL_SCOPE_ADDITIONS = [
  'feature_flag:read',
  'feature_flag:write',
  'property_definition:read',
] as const;
