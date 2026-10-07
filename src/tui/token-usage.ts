/** The token HUD's running estimate: each assistant turn's usage, reconciled to the run's total at the end. */
import type { TokenUsageDelta } from '@agent/types';
import { computeTokenCostUsd } from '@shared/token-pricing';

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

/** Total tokens across all counters, to detect "no agent turns yet". */
export function totalTokenCount(usage: TokenUsageSnapshot): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheCreationTokens
  );
}

/** Add one turn's usage; a reconciled total stays as it is. */
export function addTokenUsage(
  usage: TokenUsageSnapshot,
  delta: TokenUsageDelta,
): TokenUsageSnapshot {
  if (usage.costIsFinal) return usage;
  return {
    inputTokens: usage.inputTokens + delta.inputTokens,
    outputTokens: usage.outputTokens + delta.outputTokens,
    cacheReadTokens: usage.cacheReadTokens + delta.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens + delta.cacheCreationTokens,
    costUsd: usage.costUsd + computeTokenCostUsd(delta),
    costIsFinal: false,
  };
}
