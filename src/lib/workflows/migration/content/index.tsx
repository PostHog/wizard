/**
 * Migration learn-deck composer. Picks topic decks to play alongside the
 * generic migration deck based on the command + product combo the operator
 * invoked.
 *
 * The active variant is read from `session.skillId`, which the wizard sets
 * from `migrate --product=<id>` (`mapCliOptions` in migration/index.ts).
 * Variants whose source SDK is a feature flag / experimentation tool play
 * the FF/experiments deck. Add more topic decks to TOPIC_DECKS_BY_PRODUCT
 * as new variants ship.
 */

import type { ContentBlock } from '../../../../ui/tui/primitives/content-types.js';
import type { WizardStore } from '../../../../ui/tui/store.js';
import { getMigrationBlocks } from './migration.js';
import { FEATURE_FLAGS_EXPERIMENTS_BLOCKS } from './feature-flags-experiments.js';

const TOPIC_DECKS_BY_PRODUCT: Record<string, ContentBlock[]> = {
  statsig: FEATURE_FLAGS_EXPERIMENTS_BLOCKS,
};

function productFromSkillId(skillId: string | null): string | null {
  const prefix = 'migrate-';
  if (!skillId || !skillId.startsWith(prefix)) return null;
  return skillId.slice(prefix.length);
}

export const getContentBlocks = (store?: WizardStore): ContentBlock[] => {
  const product = productFromSkillId(store?.session.skillId ?? null);
  const topicDeck = product ? TOPIC_DECKS_BY_PRODUCT[product] ?? [] : [];
  return [...getMigrationBlocks(store), ...topicDeck];
};
