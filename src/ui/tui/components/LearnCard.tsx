/**
 * LearnCard — PostHog educational content with animated text reveal.
 */

import { Box, Text } from 'ink';
import { useEffect, useMemo, useRef } from 'react';
import { Colors } from '../styles.js';
import type { WizardStore } from '../store.js';
import { ContentSequencer, TextRevealMode } from '../primitives/index.js';
import type { ContentBlock } from '../primitives/index.js';
import { DiscoveredFeature } from '../../../lib/wizard-session.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { COLLAPSED_COUNT, EXPANDED_COUNT } from '../primitives/TabContainer.js';

/**
 * StatusPeek — Expands the status bar once for `duration` ms, then collapses.
 * Uses a LearnCard-scoped ref so the peek only fires once, even if the block
 * is evicted by viewport scrolling and later re-mounted.
 */
const StatusPeek = ({
  store,
  duration = 5000,
  peekedRef,
}: {
  store?: WizardStore;
  duration?: number;
  peekedRef: ReturnType<typeof useRef<boolean>>;
}) => {
  useEffect(() => {
    if (peekedRef.current) return;
    peekedRef.current = true;
    store?.setStatusExpanded(true);
    const timer = setTimeout(() => {
      store?.setStatusExpanded(false);
    }, duration);
    return () => clearTimeout(timer);
  }, [store, duration, peekedRef]);

  return (
    <Text>
      Press{' '}
      <Text color={Colors.accent} bold>
        S
      </Text>{' '}
      to expand or collapse the status report below.
    </Text>
  );
};

const STATIC_LINES_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 8000,
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
      <Text>posthog.capture()</Text>
      {'        │'}
    </Text>,
    <Text color="yellow">
      {'  │ '}
      <Text bold>PostHog SDK</Text>
      {'                 │'}
    </Text>,
    <Text color="cyan">
      {'  │   ↓ '}
      <Text>HTTP POST</Text>
      {'                │'}
    </Text>,
    <Text color={Colors.accent}>
      {'  │ '}
      <Text bold>PostHog Cloud</Text>
      {'                │'}
    </Text>,
    <Text color="cyan">
      {'  │   ↓ '}
      <Text>query + visualize</Text>
      {'        │'}
    </Text>,
    <Text color="green">
      {'  │ '}
      <Text bold>Dashboards & Insights</Text>
      {'        │'}
    </Text>,
    <Text color="cyan">{'  └──────────────────────────────┘'}</Text>,
  ],
};

const FUNNEL_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 350,
  pause: 8000,
  lines: [
    <Text bold>{'  Funnel · ride conversion'}</Text>,
    <Text> </Text>,
    // Step 1
    <Text>
      {'  '}
      <Text bold>1</Text>
      {'  app_launched'}
      {'                '}
      <Text bold color="green">
        100.00%
      </Text>
    </Text>,
    <Text color="cyan">{'     ██████████████████████████████'}</Text>,
    <Text dimColor>{'     → 1,200 users'}</Text>,
    <Text> </Text>,
    // Step 2
    <Text>
      {'  '}
      <Text bold>2</Text>
      {'  ride_requested'}
      {'       '}
      <Text dimColor>{'avg 2m 30s'}</Text>
      {'   '}
      <Text bold color="green">
        72.00%
      </Text>
    </Text>,
    <Text>
      {'     '}
      <Text color="cyan">{'██████████████████████'}</Text>
      <Text dimColor>{'░░░░░░░░░'}</Text>
    </Text>,
    <Text>
      {'     '}
      <Text dimColor>→ 864 users</Text>
      {'  '}
      <Text color="red">↘</Text>
      <Text dimColor>{' 336 (28%) dropped off'}</Text>
    </Text>,
    <Text> </Text>,
    // Step 3
    <Text>
      {'  '}
      <Text bold>3</Text>
      {'  ride_accepted'}
      {'        '}
      <Text dimColor>{'avg 5m 12s'}</Text>
      {'   '}
      <Text bold color="green">
        51.00%
      </Text>
    </Text>,
    <Text>
      {'     '}
      <Text color="cyan">{'██████████████████'}</Text>
      <Text dimColor>{'░░░░░░░░░░░░░'}</Text>
    </Text>,
    <Text>
      {'     '}
      <Text dimColor>→ 612 users</Text>
      {'  '}
      <Text color="red">↘</Text>
      <Text dimColor>{' 252 (29%) dropped off'}</Text>
    </Text>,
    <Text> </Text>,
    // Step 4
    <Text>
      {'  '}
      <Text bold>4</Text>
      {'  ride_started'}
      {'         '}
      <Text dimColor>{'avg 1m 45s'}</Text>
      {'   '}
      <Text bold color="green">
        38.00%
      </Text>
    </Text>,
    <Text>
      {'     '}
      <Text color="cyan">{'█████████████'}</Text>
      <Text dimColor>{'░░░░░░░░░░░░░░░░░░'}</Text>
    </Text>,
    <Text>
      {'     '}
      <Text dimColor>→ 456 users</Text>
      {'  '}
      <Text color="red">↘</Text>
      <Text dimColor>{' 156 (25%) dropped off'}</Text>
    </Text>,
  ],
};

const TAIL_BLOCKS: ContentBlock[] = [
  {
    content: 'Events are the foundation of analytics in PostHog.',
    pause: 4000,
  },

  {
    content:
      'Every time an action is performed in your codebase — clicking a button, viewing a page, or submitting a form — an event is captured.',
    pause: 6000,
  },

  { content: "Here's the flow.", pause: 2000 },

  STATIC_LINES_BLOCK,

  { type: 'clear', pause: 3000 },

  {
    content:
      'With enough data and signal, you can answer powerful questions about your product.',
    pause: 4000,
  },

  { content: 'And create insights.', pause: 2000 },

  FUNNEL_BLOCK,

  { type: 'clear', pause: 3000 },

  { content: 'Then decide what to build next.', pause: 3000 },

  { type: 'clear', pause: 3000 },
];

/** Fixed chrome: ScreenContainer (3) + TabContainer tab bar (2) */
const FIXED_CHROME = 5;
const HEADER_ROWS = 2; // title + spacer
const MIN_CONTENT_ROWS = 6;

interface LearnCardProps {
  store?: WizardStore;
}

export const LearnCard = ({ store }: LearnCardProps) => {
  const peekedRef = useRef(false);
  const [columns, rows] = useStdoutDimensions();

  const blocks = useMemo<ContentBlock[]>(
    () => [
      {
        content: 'Welcome.',
        pause: 3000,
        mode: TextRevealMode.Typewriter,
        animationInterval: 160,
      },
      { content: 'The Wizard is an agent.', pause: 3000 },
      {
        content: 'It handles the entire PostHog setup process on your behalf.',
        pause: 4000,
      },
      {
        content: "As we speak, it's working on the tasks shown on the right.",
        pause: 4000,
      },
      {
        pause: 5000,
        persist: true,
        content: <StatusPeek store={store} peekedRef={peekedRef} />,
      },
      { type: 'clear', pause: 3000 },
      ...TAIL_BLOCKS,
      ...(store?.session.discoveredFeatures.includes(DiscoveredFeature.Stripe)
        ? [
            { type: 'clear' as const, pause: 3000 },
            {
              content: 'You can track Stripe revenue with PostHog.',
              pause: 3000,
            },
            {
              content:
                'Add Stripe as a data source in your PostHog project under Data Warehouse to join revenue data with your product analytics.',
              pause: 5000,
            },
          ]
        : []),
      ...(store?.session.discoveredFeatures.includes(DiscoveredFeature.LLM)
        ? [
            { type: 'clear' as const, pause: 3000 },
            {
              content: 'PostHog can also help you track your LLM costs.',
              pause: 3000,
            },
            {
              content:
                'We detected LLM dependencies in your project. LLM analytics lets you monitor token usage, latency, and costs across your AI features.',
              pause: 5000,
            },
          ]
        : []),
    ],
    [store],
  );

  // Dynamic status bar height: messages + border when present
  const hasStatus = store ? store.statusMessages.length > 0 : false;
  const statusBarRows = hasStatus
    ? (store?.statusExpanded ? EXPANDED_COUNT : COLLAPSED_COUNT) + 1
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
        Learn
      </Text>
      <Box height={1} />
      <ContentSequencer
        blocks={blocks}
        mode={TextRevealMode.SentenceBySentence}
        maxHeight={maxHeight}
        availableWidth={paneWidth}
        startDelay={2000}
      />
    </Box>
  );
};
