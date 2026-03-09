/**
 * LearnCard — PostHog educational content with animated text reveal.
 * Press [p] to cycle through animation modes.
 */

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { Colors } from '../styles.js';
import {
  TextReveal,
  TextRevealMode,
  TEXT_REVEAL_MODE_LABELS,
  TEXT_REVEAL_MODE_COUNT,
} from '../primitives/index.js';

const PARAGRAPHS = [
  'Events are the foundation of analytics in PostHog. Every time a user performs an action — clicking a button, viewing a page, submitting a form — an event is captured. These events build a living picture of how people actually use your product, not how you imagine they do.',

  'Properties add depth to every event. You can attach any metadata you want: which page they were on, what experiment variant they saw, whether they were on mobile or desktop, their subscription tier. The richer your properties, the more powerful your analysis becomes.',

  'Persons tie events to real humans. When a user signs up, you can identify them and stitch together their anonymous browsing history with their authenticated sessions. Now when a customer emails about a bug, you can replay exactly what they experienced.',

  'Groups let you analyze at the company level, not just the individual. If you are building B2B software, you probably care about how Acme Corp uses your product, not just what Jane from Acme did on Tuesday. Groups make that easy.',

  'Feature flags let you ship code without shipping risk. Wrap new functionality in a flag, roll it out to 5% of users, watch the metrics, then go to 100% when you are confident. Or kill it instantly if something goes wrong — no deploy needed.',

  'Session replay shows you exactly what users see and do. Instead of guessing why a conversion funnel drops off at step 3, you can watch real sessions and see the confusion first-hand. It is the fastest path from "something is wrong" to "I know exactly what is wrong."',

  'Experiments take the guesswork out of product decisions. Set up an A/B test, define your goal metric, and let PostHog tell you which variant wins with statistical significance. No more shipping features based on gut feeling alone.',

  'The data warehouse connects PostHog to everything else. Pull in Stripe revenue data, Hubspot CRM records, or your own database tables. Join them with your event data and suddenly you can answer questions like "do users who came from Google Ads have higher lifetime value?"',
];

export const LearnCard = () => {
  const [mode, setMode] = useState<TextRevealMode>(TextRevealMode.Typewriter);

  useInput((input) => {
    if (input === 'p') {
      setMode((m) => ((m + 1) % TEXT_REVEAL_MODE_COUNT) as TextRevealMode);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={Colors.accent}>
        Learn about PostHog
      </Text>
      <Text dimColor>
        Text style: <Text bold>{TEXT_REVEAL_MODE_LABELS[mode]}</Text>{' '}
        <Text color={Colors.accent}>[p]</Text> to switch
      </Text>
      <Box height={1} />
      <TextReveal key={mode} paragraphs={PARAGRAPHS} mode={mode} />
    </Box>
  );
};
