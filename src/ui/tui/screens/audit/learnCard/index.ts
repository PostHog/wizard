import type { ComponentType } from 'react';
import {
  ActivationThresholdSlide,
  BackendTrackingSlide,
  CoreFlowEvaluationSlide,
  DropoffQuestionSlide,
  EventNamesVocabularySlide,
  EventPropertiesSlide,
  InternalTrafficSlide,
  SignupEventSlide,
  StableDistinctIdSlide,
} from './best-practices.js';
import {
  ExperimentExposureSlide,
  ExceptionAnalyticsSlide,
  FeatureFlagIdentitySlide,
  FunnelCriticalPathSlide,
  CustomerContextSlide,
  InsightToActionSlide,
  ReplayAccessSlide,
  RevenueJourneySlide,
  SourceMapsSlide,
} from './cross-products.js';
import {
  AiDashboardBuilderSlide,
  AiIncidentTriageSlide,
  AiMcpWorkflowSlide,
  AiModelCostSlide,
  AiQualityRegressionSlide,
  AiQueryDraftingSlide,
  AiReplayPatternsSlide,
  AiSessionReviewSlide,
  ReplayMcpFixSlide,
} from './ai-superpowers.js';
import {
  AnonymousEventsSlide,
  AiCostAttributionSlide,
  DataRetentionSlide,
  GroupOnceSlide,
  IdentifyOnceSlide,
  NoisyEventSamplingSlide,
  PageviewVolumeSlide,
  ReplayBillingLimitsSlide,
  ToolConsolidationSlide,
} from './cost-cutting.js';

export {
  ActivationThresholdSlide,
  BackendTrackingSlide,
  CoreFlowEvaluationSlide,
  DropoffQuestionSlide,
  EventNamesVocabularySlide,
  EventPropertiesSlide,
  InternalTrafficSlide,
  SignupEventSlide,
  StableDistinctIdSlide,
} from './best-practices.js';
export {
  ExperimentExposureSlide,
  ExceptionAnalyticsSlide,
  FeatureFlagIdentitySlide,
  FunnelCriticalPathSlide,
  CustomerContextSlide,
  InsightToActionSlide,
  ReplayAccessSlide,
  RevenueJourneySlide,
  SourceMapsSlide,
} from './cross-products.js';
export {
  AiDashboardBuilderSlide,
  AiIncidentTriageSlide,
  AiMcpWorkflowSlide,
  AiModelCostSlide,
  AiQualityRegressionSlide,
  AiQueryDraftingSlide,
  AiReplayPatternsSlide,
  AiSessionReviewSlide,
  ReplayMcpFixSlide,
} from './ai-superpowers.js';
export {
  AnonymousEventsSlide,
  AiCostAttributionSlide,
  DataRetentionSlide,
  GroupOnceSlide,
  IdentifyOnceSlide,
  NoisyEventSamplingSlide,
  PageviewVolumeSlide,
  ReplayBillingLimitsSlide,
  ToolConsolidationSlide,
} from './cost-cutting.js';

export type AuditLearnCategory =
  | 'best-practices'
  | 'cross-products'
  | 'ai-superpowers'
  | 'cost-cutting';

export interface AuditLearnTip {
  category: AuditLearnCategory;
  Slide: ComponentType;
  /** Optional follow-link the user can open with the "Open link" key. */
  link?: string;
}

/** A slide may attach its follow-link as a static `link` property. */
type Slide = ComponentType & { link?: string };

interface SlideEntry {
  Slide: ComponentType;
  link?: string;
}

const slideEntry = (Slide: Slide): SlideEntry => ({ Slide, link: Slide.link });

export const AUDIT_LEARN_CATEGORY_ORDER: AuditLearnCategory[] = [
  'best-practices',
  'cross-products',
  'ai-superpowers',
  'cost-cutting',
];

export const AUDIT_LEARN_TIPS_BY_CATEGORY: Record<
  AuditLearnCategory,
  SlideEntry[]
> = {
  'best-practices': [
    slideEntry(SignupEventSlide),
    slideEntry(EventNamesVocabularySlide),
    slideEntry(EventPropertiesSlide),
    slideEntry(StableDistinctIdSlide),
    slideEntry(ActivationThresholdSlide),
    slideEntry(BackendTrackingSlide),
    slideEntry(InternalTrafficSlide),
    slideEntry(CoreFlowEvaluationSlide),
    slideEntry(DropoffQuestionSlide),
  ],
  'cross-products': [
    slideEntry(FunnelCriticalPathSlide),
    slideEntry(FeatureFlagIdentitySlide),
    slideEntry(ExperimentExposureSlide),
    slideEntry(ReplayAccessSlide),
    slideEntry(SourceMapsSlide),
    slideEntry(RevenueJourneySlide),
    slideEntry(ExceptionAnalyticsSlide),
    slideEntry(InsightToActionSlide),
    slideEntry(CustomerContextSlide),
  ],
  'ai-superpowers': [
    slideEntry(AiQueryDraftingSlide),
    slideEntry(AiSessionReviewSlide),
    slideEntry(AiIncidentTriageSlide),
    slideEntry(ReplayMcpFixSlide),
    slideEntry(AiDashboardBuilderSlide),
    slideEntry(AiReplayPatternsSlide),
    slideEntry(AiMcpWorkflowSlide),
    slideEntry(AiModelCostSlide),
    slideEntry(AiQualityRegressionSlide),
  ],
  'cost-cutting': [
    slideEntry(AnonymousEventsSlide),
    slideEntry(DataRetentionSlide),
    slideEntry(NoisyEventSamplingSlide),
    slideEntry(IdentifyOnceSlide),
    slideEntry(GroupOnceSlide),
    slideEntry(PageviewVolumeSlide),
    slideEntry(ReplayBillingLimitsSlide),
    slideEntry(ToolConsolidationSlide),
    slideEntry(AiCostAttributionSlide),
  ],
};

function shuffle<T>(array: readonly T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Return a fresh playlist containing every tip exactly once. Walks the
 * categories in fixed AUDIT_LEARN_CATEGORY_ORDER, picking a random
 * unseen tip from each category per round, until every tip has been
 * placed. No repeats until the queue is exhausted; call again to
 * reshuffle when starting a new pass.
 */
export const buildShuffledPlaylist = (): AuditLearnTip[] => {
  const queues = new Map(
    AUDIT_LEARN_CATEGORY_ORDER.map((category) => [
      category,
      shuffle(AUDIT_LEARN_TIPS_BY_CATEGORY[category]),
    ]),
  );
  const playlist: AuditLearnTip[] = [];
  const maxRounds = Math.max(
    ...AUDIT_LEARN_CATEGORY_ORDER.map(
      (category) => AUDIT_LEARN_TIPS_BY_CATEGORY[category].length,
    ),
  );
  for (let round = 0; round < maxRounds; round += 1) {
    for (const category of AUDIT_LEARN_CATEGORY_ORDER) {
      const entry = queues.get(category)?.[round];
      if (entry)
        playlist.push({ category, Slide: entry.Slide, link: entry.link });
    }
  }
  return playlist;
};
