/**
 * TipsCard — Shows PostHog tips during the agent run.
 * Reactively shows/hides tips based on discovered features.
 * Supports toggling additional features via key bindings.
 */

import { Box, Text, useInput } from 'ink';
import type { WizardStore } from '@ui/tui/store';
import { Colors, Icons } from '@ui/tui/styles';
import { DiscoveredFeature, AdditionalFeature } from '@lib/wizard-session';

/** A discrete tip shown in the TipsCard during the agent run. */
export interface Tip {
  /** Unique identifier */
  id: string;
  /** Title line */
  title: string;
  /** Description shown below the title */
  description: string;
  /** Optional URL shown after the description */
  url?: string;
  /** When provided, the tip is only shown if this returns true */
  visible?: (store: WizardStore) => boolean;
  /** Optional key binding that toggles an AdditionalFeature */
  toggle?: {
    /** The key the user presses (lowercase) */
    key: string;
    /** The additional feature to enqueue */
    feature: AdditionalFeature;
    /** Label shown when toggled on */
    enabledLabel: string;
    /** Prompt shown when not yet toggled */
    prompt: string;
    /** Returns true if already toggled */
    isEnabled: (store: WizardStore) => boolean;
  };
}

/**
 * The default deck — generic PostHog onboarding tips, shown for any
 * program that doesn't supply its own via `ProgramConfig.getTips`.
 * Program-specific copy (e.g. the self-driving scout/source
 * explainers) lives in that program's content, not here — this stays the
 * neutral fallback.
 */
export const DEFAULT_TIPS: Tip[] = [
  {
    id: 'persons',
    title: 'You can also track people and groups with PostHog',
    description:
      "Events can be associated with the humans who generate them, letting you understand a specific user or customer's situation.",
  },
  {
    id: 'properties',
    title: 'Get way more detail using properties',
    description:
      'Events and person records can have any properties you want. Track things like how they found your website, what subscription tier they choose, and much more.',
  },
  {
    id: 'slack',
    title: 'Use PostHog in Slack',
    description:
      'Connect the PostHog Slack app to analyze data and ship product changes — deploy flags, open PRs, run queries — just by tagging @PostHog:',
    url: 'https://posthog.com/slack',
  },
  {
    id: 'stripe',
    title: 'You can track Stripe revenue with PostHog',
    description: 'Add Stripe as a data source while you wait:',
    url: 'https://app.posthog.com/project/data-warehouse/new-source?kind=Stripe',
    visible: (store) =>
      store.session.discoveredFeatures.includes(DiscoveredFeature.Stripe),
  },
  {
    id: 'llm',
    title: 'PostHog can also help you track your LLM costs',
    description: '',
    visible: (store) =>
      store.session.discoveredFeatures.includes(DiscoveredFeature.LLM),
    toggle: {
      key: 'l',
      feature: AdditionalFeature.LLM,
      enabledLabel: 'AI observability setup queued next',
      prompt: 'We detected LLM dependencies in your project.',
      isEnabled: (store) => store.session.llmOptIn,
    },
  },
];

export const TipsCard = ({
  store,
  tips = DEFAULT_TIPS,
}: {
  store: WizardStore;
  tips?: Tip[];
}) => {
  useInput((input) => {
    for (const tip of tips) {
      if (
        tip.toggle &&
        input.toLowerCase() === tip.toggle.key &&
        (!tip.visible || tip.visible(store)) &&
        !tip.toggle.isEnabled(store)
      ) {
        store.enableFeature(tip.toggle.feature);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={Colors.accent}>
        Tips
      </Text>
      <Box height={1} />

      {tips
        .filter((tip) => !tip.visible || tip.visible(store))
        .map((tip) => (
          <Box key={tip.id} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={Colors.accent}>{Icons.diamond} </Text>
              <Text bold>{tip.title}</Text>
            </Text>

            {tip.toggle ? (
              tip.toggle.isEnabled(store) ? (
                <Text color={Colors.success}>
                  {Icons.check} {tip.toggle.enabledLabel}
                </Text>
              ) : (
                <Text dimColor>
                  {tip.toggle.prompt} Press{' '}
                  <Text bold color={Colors.accent}>
                    {tip.toggle.key.toUpperCase()}
                  </Text>{' '}
                  to enable.
                </Text>
              )
            ) : (
              <Text dimColor>
                {tip.description}
                {tip.url && (
                  <>
                    {' '}
                    <Text color="cyan">{tip.url}</Text>
                  </>
                )}
              </Text>
            )}
          </Box>
        ))}
    </Box>
  );
};
