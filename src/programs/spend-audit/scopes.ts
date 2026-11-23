/**
 * Extra scopes the spend audit needs on top of `WIZARD_OAUTH_SCOPES`.
 *
 * The audit tasks read flags (`feature-flags-list`), recordings (the replay
 * settings and the watched share) and exceptions (`$exception` issues) to size
 * savings. Without a scope the matching area resolves as unmeasured rather than
 * failing the run. It never asks for billing: the product prices the volumes.
 */
export const SPEND_AUDIT_SCOPE_ADDITIONS = [
  'feature_flag:read',
  'session_recording:read',
  'error_tracking:read',
] as const;
