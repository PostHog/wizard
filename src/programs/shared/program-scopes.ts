/**
 * Scope additions more than one program asks for. A program widens the base
 * set with its config's `oauthScopeAdditions`, merged by `withScopeAdditions`
 * (`@shared/oauth-scopes`); `getOAuthScopesForProgram` in
 * `program-registry.ts` looks a program's additions up. A program's own
 * additions live in its folder.
 */

/**
 * Extra scopes the warehouse-source program needs on top of
 * `WIZARD_OAUTH_SCOPES`. The agent creates data warehouse sources directly
 * (`external-data-sources-create`) and lists what's connected
 * (`external-data-sources-list`) to verify the result. Both are already within
 * the wizard OAuth app's scope ceiling — the self-driving program requests the
 * same pair.
 */
export const WAREHOUSE_SOURCE_SCOPE_ADDITIONS = [
  'external_data_source:read',
  'external_data_source:write',
] as const;
