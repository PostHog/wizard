/**
 * Whether this run's OAuth grant is known to be dead.
 *
 * Process-global on purpose. A run has exactly one login, but the two sides of
 * this fact are far apart: the pre-run refresh learns it in `authenticate.ts`,
 * and the only consumer is the 401 handler inside the agent message loop, which
 * holds no session. Threading it would mean a field on `AgentConfig` set at four
 * `initializeAgent` call sites — and the session it would read from may be a
 * shallow copy (`prepareRunSession`), so the value could be written to one
 * object and read from another.
 *
 * A leaf module with no imports, so either side can depend on it without a cycle.
 */

let grantRevoked = false;

/**
 * Record that the token endpoint permanently refused this grant. Not an abort:
 * the access token in hand may still have minutes of life, so the run continues
 * and this only decides what a later 401 gets blamed on.
 */
export function markGrantRevoked(): void {
  grantRevoked = true;
}

/** True once a token refresh failed because the grant itself is gone. */
export function isGrantRevoked(): boolean {
  return grantRevoked;
}

/** Test hook, mirroring `resetGatewaySession`. */
export function resetAuthSessionState(): void {
  grantRevoked = false;
}
