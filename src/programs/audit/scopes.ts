/**
 * Extra scopes the audit program needs on top of `WIZARD_OAUTH_SCOPES`.
 *
 * The Live Data step calls `error-tracking-recommendations-list`, which needs
 * `error_tracking:read`. Without it the call 403s, and the step skips its whole
 * sweep, health issues included.
 */
export const AUDIT_SCOPE_ADDITIONS = ['error_tracking:read'] as const;
