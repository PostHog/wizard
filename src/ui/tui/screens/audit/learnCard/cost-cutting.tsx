import { Box, Text } from 'ink';
import { TerminalLink } from './maxLink.js';

const PRODUCT_COSTS_DOCS =
  'https://posthog.com/docs/product-analytics/cutting-costs';
const REPLAY_PRICING_DOCS = 'https://posthog.com/docs/session-replay/pricing';
const USE_CASE_SELLING_DOCS =
  'https://posthog.com/handbook/growth/use-case-selling/use-case-selling';
const AI_LLM_OBSERVABILITY_DOCS =
  'https://posthog.com/handbook/growth/use-case-selling/ai-llm-observability';

const CostTip = ({ url, children }: { url: string; children: string }) => (
  <Box flexDirection="column">
    <Text>{children}</Text>
    <Box height={1} />
    <TerminalLink url={url}>
      <Text color="cyan" bold underline>
        Learn more in the docs ↗
      </Text>
    </TerminalLink>
  </Box>
);

/** Build a docs-link slide that carries its href as the open-link target. */
const costTipSlide = (link: string, copy: string) =>
  Object.assign(() => <CostTip url={link}>{copy}</CostTip>, { link });

export const AnonymousEventsSlide = costTipSlide(
  `${PRODUCT_COSTS_DOCS}#use-anonymous-events`,
  'Use anonymous events where identity is not needed. They preserve signal without paying person-processing costs for traffic that has no person.',
);

export const DataRetentionSlide = costTipSlide(
  `${PRODUCT_COSTS_DOCS}#creating-a-billable-usage-dashboard`,
  'Make a billable usage dashboard. Cost cuts are easier when you can see which events, SDKs, and products are driving the bill.',
);

export const NoisyEventSamplingSlide = costTipSlide(
  `${PRODUCT_COSTS_DOCS}#configure-autocapture`,
  'Autocapture is useful, but it can capture more than you need. Use allow and ignore lists before low-value clicks become high-volume noise.',
);

export const IdentifyOnceSlide = costTipSlide(
  `${PRODUCT_COSTS_DOCS}#only-call-identify-once-per-session`,
  'Call identify once per session. Re-identifying the same user repeatedly sends unnecessary events and makes the ledger noisier.',
);

export const GroupOnceSlide = costTipSlide(
  `${PRODUCT_COSTS_DOCS}#only-call-group-once-per-session`,
  'Call group once per session on the client. Duplicate groupidentify events are easy to miss until they show up in usage.',
);

export const PageviewVolumeSlide = costTipSlide(
  `${PRODUCT_COSTS_DOCS}#disable-pageview-or-pageleave-events`,
  'If automatic pageviews or pageleaves are not useful for your analysis, disable them and capture only the pages you care about.',
);

export const ReplayBillingLimitsSlide = costTipSlide(
  REPLAY_PRICING_DOCS,
  'Session Replay is billed by recordings captured. Use billing limits and sampling rules before replay volume surprises you.',
);

export const ToolConsolidationSlide = costTipSlide(
  USE_CASE_SELLING_DOCS,
  'One connected stack can replace a pile of point tools. Consolidation saves money, but the bigger win is no longer reconciling data between vendors.',
);

export const AiCostAttributionSlide = costTipSlide(
  AI_LLM_OBSERVABILITY_DOCS,
  'Track AI cost by model, feature, user, and organization. Cost control starts when you know which product paths are spending the money.',
);
