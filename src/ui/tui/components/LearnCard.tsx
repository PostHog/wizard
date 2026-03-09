/**
 * LearnCard — PostHog educational content with animated text reveal.
 * Press [p] to cycle through animation modes.
 */

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { Colors } from '../styles.js';
import type { WizardStore } from '../store.js';
import {
  ContentSequencer,
  TextRevealMode,
  TEXT_REVEAL_MODE_LABELS,
  TEXT_REVEAL_MODE_COUNT,
} from '../primitives/index.js';
import type { ContentBlock } from '../primitives/index.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { COLLAPSED_COUNT, EXPANDED_COUNT } from '../primitives/TabContainer.js';

const CONTENT: ContentBlock[] = [
  'Hello there. Thanks for trying out the Wizard.',

  "Wondering what it does? Let's show you around.",

  {
    type: 'lines',
    interval: 250,
    pause: 4000,
    lines: [
      <Text color="cyan">{'  ┌──────────────────────────────┐'}</Text>,
      <Text color="cyan">
        {'  │ '}
        <Text bold color="white">
          Your App
        </Text>
        {'                     │'}
      </Text>,
      <Text color="cyan">
        {'  │   ↓ '}
        <Text dimColor>posthog.capture()</Text>
        {'        │'}
      </Text>,
      <Text color="yellow">
        {'  │ '}
        <Text bold>PostHog JS SDK</Text>
        {'               │'}
      </Text>,
      <Text color="cyan">
        {'  │   ↓ '}
        <Text dimColor>HTTP POST</Text>
        {'                │'}
      </Text>,
      <Text color={Colors.accent}>
        {'  │ '}
        <Text bold>PostHog Cloud</Text>
        {'                │'}
      </Text>,
      <Text color="cyan">
        {'  │   ↓ '}
        <Text dimColor>query + visualize</Text>
        {'        │'}
      </Text>,
      <Text color="green">
        {'  │ '}
        <Text bold>Dashboards & Insights</Text>
        {'        │'}
      </Text>,
      <Text color="cyan">{'  └──────────────────────────────┘'}</Text>,
    ],
  },

  'Events are the foundation of analytics in PostHog. Every time a user performs an action — clicking a button, viewing a page, submitting a form — an event is captured. These events build a living picture of how people actually use your product, not how you imagine they do.',

  'Properties add depth to every event. You can attach any metadata you want: which page they were on, what experiment variant they saw, whether they were on mobile or desktop, their subscription tier. The richer your properties, the more powerful your analysis becomes.',

  {
    type: 'node',
    pause: 5000,
    content: (
      <Box flexDirection="column">
        <Text bold color={Colors.accent}>
          {'◆ '}
          <Text color="white">The PostHog product suite</Text>
        </Text>
        <Text>
          {' '}
          <Text color="cyan">Analytics</Text> ·{' '}
          <Text color="yellow">Session Replay</Text> ·{' '}
          <Text color="green">Feature Flags</Text>
        </Text>
        <Text>
          {' '}
          <Text color="magenta">Experiments</Text> ·{' '}
          <Text color={Colors.accent}>Surveys</Text> ·{' '}
          <Text color="blue">Data Warehouse</Text>
        </Text>
      </Box>
    ),
  },

  'Persons tie events to real humans. When a user signs up, you can identify them and stitch together their anonymous browsing history with their authenticated sessions. Now when a customer emails about a bug, you can replay exactly what they experienced.',

  'Groups let you analyze at the company level, not just the individual. If you are building B2B software, you probably care about how Acme Corp uses your product, not just what Jane from Acme did on Tuesday. Groups make that easy.',

  'Feature flags let you ship code without shipping risk. Wrap new functionality in a flag, roll it out to 5% of users, watch the metrics, then go to 100% when you are confident. Or kill it instantly if something goes wrong — no deploy needed.',

  'Session replay shows you exactly what users see and do. Instead of guessing why a conversion funnel drops off at step 3, you can watch real sessions and see the confusion first-hand. It is the fastest path from "something is wrong" to "I know exactly what is wrong."',

  'Experiments take the guesswork out of product decisions. Set up an A/B test, define your goal metric, and let PostHog tell you which variant wins with statistical significance. No more shipping features based on gut feeling alone.',

  'The data warehouse connects PostHog to everything else. Pull in Stripe revenue data, Hubspot CRM records, or your own database tables. Join them with your event data and suddenly you can answer questions like "do users who came from Google Ads have higher lifetime value?"',
];

/** Fixed chrome: ScreenContainer (3) + TabContainer tab bar (2) */
const FIXED_CHROME = 5;
const HEADER_ROWS = 3; // title + mode label + spacer
const MIN_CONTENT_ROWS = 6;

interface LearnCardProps {
  store?: WizardStore;
}

export const LearnCard = ({ store }: LearnCardProps) => {
  const [mode, setMode] = useState<TextRevealMode>(TextRevealMode.Typewriter);
  const [columns, rows] = useStdoutDimensions();

  useInput((input) => {
    if (input === 'p') {
      setMode((m) => ((m + 1) % TEXT_REVEAL_MODE_COUNT) as TextRevealMode);
    }
  });

  // Dynamic status bar height: messages + border when present
  const hasStatus = store ? store.statusMessages.length > 0 : false;
  const statusBarRows = hasStatus
    ? (store!.statusExpanded ? EXPANDED_COUNT : COLLAPSED_COUNT) + 1
    : 0;

  const contentHeight = rows - FIXED_CHROME - statusBarRows;
  const tooSmall = contentHeight < MIN_CONTENT_ROWS;

  const maxHeight = Math.max(1, contentHeight - HEADER_ROWS);
  // Half of clamped content width, minus paddingX on both sides
  const paneWidth = Math.floor((Math.min(120, columns) - 2) / 2) - 2;

  // Always render so ContentSequencer stays mounted (preserves activeIdx).
  // When too small, hide visually via display="none".
  return (
    <Box
      flexDirection="column"
      paddingX={1}
      display={tooSmall ? 'none' : 'flex'}
    >
      <Text bold color={Colors.accent}>
        Learn about PostHog
      </Text>
      <Text dimColor>
        Text style: <Text bold>{TEXT_REVEAL_MODE_LABELS[mode]}</Text>{' '}
        <Text color={Colors.accent}>[p]</Text> to switch
      </Text>
      <Box height={1} />
      <ContentSequencer
        blocks={CONTENT}
        mode={mode}
        maxHeight={maxHeight}
        availableWidth={paneWidth}
      />
    </Box>
  );
};
