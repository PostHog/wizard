/**
 * Running token/cost estimate for the hidden Ctrl+T HUD. Accumulated live
 * from each assistant turn's usage (see `agent-interface.ts`), then
 * reconciled to the SDK's authoritative `total_cost_usd` once the run
 * completes — `costIsFinal` flips so the HUD can show the number as exact
 * rather than a running estimate.
 */
export interface TokenUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  costIsFinal: boolean;
}

export const EMPTY_TOKEN_USAGE: TokenUsageSnapshot = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
  costIsFinal: false,
};

/** Total tokens across all counters in a `TokenUsageSnapshot` — used by
 *  both `TokenCostHud` and `exit-line.ts` to detect "no agent turns yet". */
export function totalTokenCount(usage: TokenUsageSnapshot): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheCreationTokens
  );
}
