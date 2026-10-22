import type { RunResult } from '@agent/types';

/** The snapshot of a detection scan's run: nothing done, with `transcriptTail` as its transcript. */
export const snapshot = (transcriptTail?: string): RunResult['snapshot'] => ({
  tasks: [],
  statusMessages: [],
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  },
  transcriptTail,
});
