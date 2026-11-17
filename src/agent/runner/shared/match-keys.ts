/** The match keys one run picks skills with. */
import type { MatchKeys } from '@shared/skill-resolution';
import type { ResolvedRunConfig } from './types';

/** The project's traits as match keys; a run whose program supplies none has none. */
export function runMatchKeys(
  config: Pick<ResolvedRunConfig, 'matchKeys'>,
): MatchKeys {
  return config.matchKeys?.() ?? {};
}
