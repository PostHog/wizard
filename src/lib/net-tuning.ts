import net from 'node:net';

/** Node's 250ms default kills a slow IPv4 connect when IPv6 is unroutable. */
export const DUAL_STACK_ATTEMPT_TIMEOUT_MS = 2_000;

// @types/node is pinned to v18; these are Node 20+ APIs.
type DualStackNet = {
  setDefaultAutoSelectFamilyAttemptTimeout(ms: number): void;
  getDefaultAutoSelectFamilyAttemptTimeout(): number;
};

export const dualStackNet = net as unknown as DualStackNet;

/** Process-wide, so axios, fetch, posthog-node, the agent SDK and MCP all get it. */
export function configureDualStackFallback(): void {
  dualStackNet.setDefaultAutoSelectFamilyAttemptTimeout(
    DUAL_STACK_ATTEMPT_TIMEOUT_MS,
  );
}
