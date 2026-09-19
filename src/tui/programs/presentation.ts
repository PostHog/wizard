/**
 * How each program presents itself while the agent runs: the LearnCard deck
 * played in the run screen's left pane, and the tips shown once it finishes.
 *
 * Presentation lives here rather than on `ProgramConfig` so program
 * definitions stay free of Ink. Programs absent from the map fall back to
 * the generic skill deck and `DEFAULT_TIPS`.
 */

import type { ProgramId, WizardStore } from '@store/types';
import type { ContentBlock } from '../primitives/index.js';
import type { Tip } from '../components/TipsCard.js';
import { getContentBlocks as agentSkillDeck } from './agent-skill/content/index.js';
import { getContentBlocks as errorTrackingDeck } from './error-tracking/content/index.js';
import { getTips as errorTrackingTips } from './error-tracking/content/tips.js';
import { getContentBlocks as sourceMapsDeck } from './error-tracking-upload-source-maps/content/index.js';
import { getContentBlocks as migrationDeck } from './migration/content/index.js';
import { getContentBlocks as posthogIntegrationDeck } from './posthog-integration/content/index.js';
import { getContentBlocks as revenueAnalyticsDeck } from './revenue-analytics/content/index.js';
import { getContentBlocks as selfDrivingDeck } from './self-driving/content/index.js';
import { getTips as selfDrivingTips } from './self-driving/content/tips.js';
import { getContentBlocks as warehouseSourceDeck } from './warehouse-source/content/index.js';

export interface ProgramPresentation {
  getContentBlocks?: (store?: WizardStore) => ContentBlock[];
  getTips?: (store?: WizardStore) => Tip[];
}

export const PROGRAM_PRESENTATION: Partial<
  Record<ProgramId, ProgramPresentation>
> = {
  'posthog-integration': { getContentBlocks: posthogIntegrationDeck },
  'revenue-analytics-setup': { getContentBlocks: revenueAnalyticsDeck },
  'warehouse-source': { getContentBlocks: warehouseSourceDeck },
  'error-tracking-upload-source-maps': { getContentBlocks: sourceMapsDeck },
  'error-tracking': {
    getContentBlocks: errorTrackingDeck,
    getTips: errorTrackingTips,
  },
  audit: { getContentBlocks: agentSkillDeck },
  'web-analytics-doctor': { getContentBlocks: agentSkillDeck },
  migration: { getContentBlocks: migrationDeck },
  'self-driving': {
    getContentBlocks: selfDrivingDeck,
    getTips: selfDrivingTips,
  },
  'agent-skill': { getContentBlocks: agentSkillDeck },
  'mcp-analytics': { getContentBlocks: agentSkillDeck },
  'replay-vision': { getContentBlocks: agentSkillDeck },
  'ai-observability': { getContentBlocks: agentSkillDeck },
  metrics: { getContentBlocks: agentSkillDeck },
};
