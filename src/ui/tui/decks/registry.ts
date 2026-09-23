import type { ProgramId } from '@programs/types';
import type { WizardStore } from '@ui/tui/store';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import type { Tip } from '@ui/tui/components/TipsCard';
import { getContentBlocks as agentSkillBlocks } from './agent-skill/index.js';
import { getContentBlocks as errorTrackingBlocks } from './error-tracking/index.js';
import { getTips as errorTrackingTips } from './error-tracking/tips.js';
import { getContentBlocks as sourceMapsBlocks } from './error-tracking-upload-source-maps/index.js';
import { getContentBlocks as migrationBlocks } from './migration/index.js';
import { getContentBlocks as integrationBlocks } from './posthog-integration/index.js';
import { getContentBlocks as selfDrivingBlocks } from './self-driving/index.js';
import { getTips as selfDrivingTips } from './self-driving/tips.js';

type LearnDeck = (store?: WizardStore) => ContentBlock[];
type TipsDeck = (store?: WizardStore) => Tip[];

// Only programs with a run-screen deck are listed. All other run screens use
// the generic skill deck, matching the original ProgramConfig fallback.
const LEARN_DECKS: Partial<Record<ProgramId, LearnDeck>> = {
  'posthog-integration': integrationBlocks,
  'revenue-analytics-setup': agentSkillBlocks,
  'warehouse-source': agentSkillBlocks,
  'error-tracking-upload-source-maps': sourceMapsBlocks,
  'error-tracking': errorTrackingBlocks,
  migration: migrationBlocks,
  'self-driving': selfDrivingBlocks,
  'agent-skill': agentSkillBlocks,
  'ai-observability': agentSkillBlocks,
  metrics: agentSkillBlocks,
};

const TIPS_DECKS: Partial<Record<ProgramId, TipsDeck>> = {
  'error-tracking': errorTrackingTips,
  'self-driving': selfDrivingTips,
};

export function getProgramContentBlocks(
  programId: ProgramId,
  store?: WizardStore,
): ContentBlock[] {
  return (LEARN_DECKS[programId] ?? agentSkillBlocks)(store);
}

export function getProgramTips(
  programId: ProgramId,
  store?: WizardStore,
): Tip[] | undefined {
  return TIPS_DECKS[programId]?.(store);
}
