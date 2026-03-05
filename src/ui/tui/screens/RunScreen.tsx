/**
 * RunScreen — Tabbed observational view of the agent run.
 *
 * Two tabs:
 *   - Status: SplitView with TipsCard (left) + ProgressList (right)
 *   - Logs: LogViewer tailing the wizard log file
 *
 * No prompts — the agent runs headlessly.
 * TipsCard reactively shows tips based on discovered features.
 */

import { Box, Text, useInput } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import {
  TabContainer,
  SplitView,
  ProgressList,
  LogViewer,
  EventPlanViewer,
} from '../primitives/index.js';
import type { ProgressItem } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import {
  DiscoveredFeature,
  AdditionalFeature,
  ADDITIONAL_FEATURE_LABELS,
} from '../../../lib/wizard-session.js';

const LOG_FILE = '/tmp/posthog-wizard.log';

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
    id: 'google-sheets',
    title: 'PostHog loves Google Sheets',
    description: 'Get your internal data in the mix:',
    url: 'https://posthog.com/docs/cdp/sources/google-sheets',
  },
  {
    id: 'stripe',
    title: 'Make better decisions using your Stripe data',
    description: 'Add Stripe as a data source while you wait:',
    url: 'https://app.posthog.com/project/data-warehouse/new-source?kind=Stripe',
    visible: (store) =>
      store.session.discoveredFeatures.includes(DiscoveredFeature.Stripe),
  },
  {
    id: 'llm',
    title: 'LLM integration detected',
    description: '',
    visible: (store) =>
      store.session.discoveredFeatures.includes(DiscoveredFeature.LLM),
    toggle: {
      key: 'l',
      feature: AdditionalFeature.LLM,
      enabledLabel: 'LLM analytics setup queued',
      prompt: 'PostHog can track LLM usage and costs.',
      isEnabled: (store) => store.session.llmOptIn,
    },
  },
];

interface RunScreenProps {
  store: WizardStore;
}

const TipsCard = ({ store }: { store: WizardStore }) => {
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
    </Box>
  );
};

export const RunScreen = ({ store }: RunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const progressItems: ProgressItem[] = store.tasks.map((t) => ({
    label: t.label,
    activeForm: t.activeForm,
    status: t.status,
  }));

  // When all tasks are done but the queue has features, show a transitional item
  const queue = store.session.additionalFeatureQueue;
  const allDone =
    progressItems.length > 0 &&
    progressItems.every((t) => t.status === 'completed');
  if (allDone && queue.length > 0) {
    const nextLabel = ADDITIONAL_FEATURE_LABELS[queue[0]];
    progressItems.push({
      label: `Set up ${nextLabel}`,
      activeForm: `Setting up ${nextLabel}...`,
      status: 'in_progress',
    });
  }

  const lastStatus =
    store.statusMessages.length > 0
      ? store.statusMessages[store.statusMessages.length - 1]
      : undefined;

  const tabs = [
    {
      id: 'status',
      label: 'Status',
      component: (
        <SplitView
          left={<TipsCard store={store} />}
          right={<ProgressList items={progressItems} title="Tasks" />}
        />
      ),
    },
    ...(store.eventPlan.length > 0
      ? [
          {
            id: 'events',
            label: 'Event plan',
            component: <EventPlanViewer events={store.eventPlan} />,
          },
        ]
      : []),
    {
      id: 'logs',
      label: 'All logs',
      component: <LogViewer filePath={LOG_FILE} />,
    },
  ];

  return <TabContainer tabs={tabs} statusMessage={lastStatus} />;
};
