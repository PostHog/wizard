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
      isEnabled: (store) =>
        store.session.additionalFeatureQueue.includes(AdditionalFeature.LLM),
    },
  },
  {
    id: 'amplitude',
    title: 'We can migrate this project from Amplitude to PostHog',
    description: '',
    visible: (store) =>
      store.session.discoveredFeatures.includes(DiscoveredFeature.Amplitude),
    toggle: {
      key: 'a',
      feature: AdditionalFeature.AmplitudeMigration,
      enabledLabel: 'Amplitude migration queued next',
      prompt: 'We detected Amplitude dependencies in your project.',
      isEnabled: (store) =>
        store.session.additionalFeatureQueue.includes(
          AdditionalFeature.AmplitudeMigration,
        ),
    },
  },
];

export const TipsCard = ({ store }: { store: WizardStore }) => {
  useInput((input) => {
    const key = input.toLowerCase();

    for (const tip of TIPS) {
      if (
        tip.toggle &&
        key === tip.toggle.key &&
        (!tip.visible || tip.visible(store)) &&
        !tip.toggle.isEnabled(store)
      ) {
        store.enableFeature(tip.toggle.feature);
      }
    }
  });

  const visibleToggleKeys = TIPS.filter(
    (tip) => tip.toggle && (!tip.visible || tip.visible(store)),
  ).map((tip) => tip.toggle!.key.toUpperCase());

  const queuePrompt =
    visibleToggleKeys.length > 0
      ? visibleToggleKeys.length === 1
        ? visibleToggleKeys[0]
        : visibleToggleKeys.join(' or ')
      : null;

  const skipHintVisible =
    store.canSkipToQueuedFeatures ||
    store.skipToQueuedFeaturesRequested ||
    queuePrompt !== null;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={Colors.accent}>
        Tips
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

      {skipHintVisible && (
        <Box marginTop={1}>
          {store.skipToQueuedFeaturesRequested ? (
            <Text color={Colors.success}>
              {Icons.check} Skipping the rest of the main setup. Queued extras
              will run next.
            </Text>
          ) : store.canSkipToQueuedFeatures ? (
            <Text dimColor>
              Press{' '}
              <Text bold color={Colors.accent}>
                X
              </Text>{' '}
              to skip the rest of the main setup and jump to the queued extras.
            </Text>
          ) : (
            <Text dimColor>
              Enable{' '}
              <Text bold color={Colors.accent}>
                {queuePrompt}
              </Text>{' '}
              first, then press{' '}
              <Text bold color={Colors.accent}>
                X
              </Text>{' '}
              to skip the rest of the main setup and jump to the queued extras.
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};
