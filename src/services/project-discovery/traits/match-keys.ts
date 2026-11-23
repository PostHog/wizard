/** Match keys: the traits skills can match on, as `resolveSkill` reads them. */

import type { MatchKeys } from '@shared/skill-resolution';
import type { Traits } from '@programs/program-contract';
import { TRAIT_NAMES, TRAITS } from './registry';

/** The traits skills can match on, as the values per match key. */
export function toMatchKeys(traits: Traits): MatchKeys {
  const keys: Record<string, readonly string[]> = {};
  for (const name of TRAIT_NAMES) {
    const value = traits[name];
    if (value === undefined || !TRAITS[name].matchKey) continue;
    keys[name] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return keys;
}
