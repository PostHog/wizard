/**
 * TipsCard — Shows PostHog tips during the agent run.
 * Reactively shows/hides tips based on discovered features.
 * Supports toggling additional features via key bindings.
 */

import { Box, Text, useInput } from 'ink';
import type { WizardStore } from '../store.js';
import { Colors, Icons } from '../styles.js';
import {
  DiscoveredFeature,
  AdditionalFeature,
} from '../../../lib/wizard-session.js';

/** A discrete tip shown in the TipsCard during the agent run. */
interface Tip {
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

const TIPS: Tip[] = [
  {
    id: 'events',
    title: 'Events are the bedrock of your PostHog data',
    description:
      'As people use your product, events build a picture of their behavior and satisfaction. Good events make great data.',
  },
  {
    id: 'persons',
    title: 'You can also track people and groups with PostHog',
    description:
      'Events can be associated with the humans who generate them, letting you understand a specific customer problem if they email about it.',
  },
  {
    id: 'properties',
    title: 'Get way more detail using properties',
    description:
      'Events and person records can have any properties you want. Track things like how they found your website, what subscription tier they choose, and much more.',
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
      enabledLabel: 'LLM analytics setup queued next',
      prompt: 'We detected LLM dependencies in your project.',
      isEnabled: (store) => store.session.llmOptIn,
    },
  },
];

export const TipsCard = ({ store }: { store: WizardStore }) => {
  useInput((input) => {
    for (const tip of TIPS) {
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
        Learn about PostHog
      </Text>
      <Box height={1} />

      {TIPS.filter((tip) => !tip.visible || tip.visible(store)).map((tip) => (
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
