import { GPT5_6_SOL_MODEL, Harness, Sequence } from '@shared/config/constants';
import type { ResolvedBinding } from '../shared/types';

/** Standalone callers can supply this resolved route without a program registry. */
export const DEFAULT_AGENT_BINDING: ResolvedBinding = {
  sequence: Sequence.linear,
  harness: Harness.pi,
  model: GPT5_6_SOL_MODEL,
  thinkingLevel: 'medium',
};
