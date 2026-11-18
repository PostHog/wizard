/**
 * Extra scopes the support program needs on top of `WIZARD_OAUTH_SCOPES`:
 *   • product_enablement:write — the enable-support task turns on Support
 *     (`products-enable` with `conversations`), which also mints the widget's
 *     public token. A purpose-built scope: the server owns the enable recipe,
 *     so this flips the product without the far broader `project:write`.
 *
 * No OAuth-ceiling edit needed: it is an unprivileged public scope object
 * covered by the apps' `@default` sentinel, and self-driving and
 * replay-vision already request it.
 */
export const SUPPORT_SCOPE_ADDITIONS = ['product_enablement:write'] as const;
