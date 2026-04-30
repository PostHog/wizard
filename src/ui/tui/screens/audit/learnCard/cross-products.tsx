import { Box, Text } from 'ink';
import { Colors } from '../../../styles.js';
import { SlideFrame, VisualBox } from './SlideFrame.js';
import { buildMaxUrl, OpenInMaxLink } from './maxLink.js';

const MiniBar = ({
  label,
  bar,
  value,
}: {
  label: string;
  bar: string;
  value: string;
}) => (
  <Text>
    <Text dimColor>{label.padEnd(10)}</Text>
    <Text color="cyan">{bar}</Text>
    <Text dimColor> </Text>
    <Text color="green">{value}</Text>
  </Text>
);

const SourceMapVisual = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.accent}>
      Source maps
    </Text>
    <Box height={1} />
    <Text dimColor>before</Text>
    <Text color="red">{'  at H  (app.8f3a.js:1:9822)'}</Text>
    <Text color="red">{'  at l  (app.8f3a.js:1:4117)'}</Text>
    <Box height={1} />
    <Text dimColor>after</Text>
    <Text color="green">{'  at handleSubmit  (Checkout.tsx:42)'}</Text>
    <Text color="green">{'  at submit        (Form.tsx:18)'}</Text>
  </Box>
);

export const FunnelCriticalPathSlide = () => (
  <SlideFrame
    visual={
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Insight stack
        </Text>
        <Box height={1} />
        <MiniBar label="trend" bar="████████████████" value="growth" />
        <MiniBar label="funnel" bar="██████████░░░░░░" value="drop-off" />
        <MiniBar label="retention" bar="███████░░░░░░░░░" value="returning" />
      </Box>
    }
  >
    Build insights from the full event stream: trends for growth, funnels for
    conversion, and retention for whether users come back.
  </SlideFrame>
);

const FEATURE_FLAG_IDENTITY_PROMPT =
  'Find all session replays where the show-super-cool-cta flag evaluated to true.';

export const FeatureFlagIdentitySlide = Object.assign(
  () => (
    <Box flexDirection="column">
      <VisualBox>
        <Box flexDirection="column">
          <Text bold color={Colors.accent}>
            Replay filters
          </Text>
          <Box height={1} />
          <Text color="gray">{'┌ Search suggested filters...     ≡ ┐'}</Text>
          <Text color="gray">{'└──────────────────────────────────┘'}</Text>
          <Box height={1} />
          <Text bold>Applied filters</Text>
          <Text>
            <Text color="cyan">{'[ Last 3 days ▾ ]'}</Text>
            <Text>{'  '}</Text>
            <Text color="cyan">{'[ > 5 active seconds ▾ ]'}</Text>
          </Text>
          <Text>
            <Text color="cyan">
              {'[ Feature: show-super-cool-cta = true × ]'}
            </Text>
          </Text>
        </Box>
      </VisualBox>
      <Text>
        Session Replay can filter recordings by feature flag variant, so flag
        rollouts are easier to debug when analytics and replay share data.
      </Text>
      <Box height={1} />
      <Text>
        Try asking PostHog AI to find all session replays where the
        show-super-cool-cta flag evaluated to <Text color="cyan">`true`</Text>.
      </Text>
      <Box marginTop={1}>
        <OpenInMaxLink />
      </Box>
    </Box>
  ),
  { link: buildMaxUrl(FEATURE_FLAG_IDENTITY_PROMPT) },
);

const EXPERIMENT_EXPOSURE_PROMPT =
  'Surface the users behind my biggest funnel drop and pull up their replays.';

export const ExperimentExposureSlide = Object.assign(
  () => (
    <Box flexDirection="column">
      <VisualBox>
        <Box flexDirection="column">
          <Text bold color={Colors.accent}>
            From chart to users
          </Text>
          <Box height={1} />
          <Text>
            <Text color="cyan">funnel step 2</Text>
            <Text dimColor>{'   ──▶   '}</Text>
            <Text color="green">12 replays</Text>
          </Text>
          <Text>
            <Text color="cyan">retention dip</Text>
            <Text dimColor>{'   ──▶   '}</Text>
            <Text color="green">watch list</Text>
          </Text>
        </Box>
      </VisualBox>
      <Text>
        Click a funnel, retention chart, or user path and jump straight to
        replays for the users behind that data point.
      </Text>
      <Box height={1} />
      <Text>
        Try asking PostHog AI to{' '}
        <Text color="cyan">
          surface the users behind your biggest funnel drop
        </Text>{' '}
        and pull up their replays.
      </Text>
      <Box marginTop={1}>
        <OpenInMaxLink />
      </Box>
    </Box>
  ),
  { link: buildMaxUrl(EXPERIMENT_EXPOSURE_PROMPT) },
);

export const ReplayAccessSlide = () => (
  <SlideFrame
    visual={
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Replay timeline
        </Text>
        <Box height={1} />
        <Text>
          <Text dimColor>{'      '}</Text>
          <Text color="red">Exception</Text>
        </Text>
        <Text>
          <Text dimColor>{'          '}</Text>
          <Text color="red">▼</Text>
        </Text>
        <Text>
          <Text dimColor>{'┃   ┃ ┃   '}</Text>
          <Text color="red" bold>
            ┃
          </Text>
          <Text dimColor>{'    ┃   ┃     ┃   ┃'}</Text>
        </Text>
        <Text>
          <Text color="cyan">{'█████████████████░'}</Text>
          <Text dimColor>{'░░░░░░░░░░░░░'}</Text>
        </Text>
        <Text dimColor>{'00:48 / 01:54'}</Text>
        <Box height={1} />
        <Text dimColor>
          ticks: <Text color="cyan">events</Text>
          {'  ·  '}
          <Text color="red">errors</Text>
          {'  ·  console  ·  network'}
        </Text>
      </Box>
    }
  >
    Replay is synced with DevTools-style context: events, console output,
    warnings, errors, and network requests on the same timeline. Click any
    exception tick to jump straight to the moment it broke.
  </SlideFrame>
);

export const SourceMapsSlide = () => (
  <SlideFrame visual={<SourceMapVisual />}>
    Error Tracking gets much sharper after source maps: production exceptions
    point back to readable code instead of bundled stack traces.
  </SlideFrame>
);

export const RevenueJourneySlide = () => (
  <SlideFrame
    visual={
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Revenue journey
        </Text>
        <Box height={1} />
        <Text>
          <Text color="cyan">ad</Text>
          <Text dimColor>{'      ── '}</Text>
          <Text color="green">CAC</Text>
          <Text dimColor> (cost to acquire)</Text>
        </Text>
        <Text dimColor>{'  ↓'}</Text>
        <Text>
          <Text color="cyan">website</Text>
        </Text>
        <Text dimColor>{'  ↓'}</Text>
        <Text>
          <Text color="cyan">signup</Text>
          <Text dimColor>{'  ── '}</Text>
          <Text color="green">activation</Text>
          <Text dimColor> (time-to-value)</Text>
        </Text>
        <Text dimColor>{'  ↓'}</Text>
        <Text>
          <Text color="cyan">paid</Text>
          <Text dimColor>{'    ── '}</Text>
          <Text color="green">LTV</Text>
          <Text dimColor> (lifetime value)</Text>
        </Text>
      </Box>
    }
  >
    Keep your website and app in the same project when you can. It connects the
    marketing journey to activation, retention, churn, CAC, and LTV.
  </SlideFrame>
);

export const ExceptionAnalyticsSlide = () => (
  <SlideFrame
    visual={
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Exceptions as events
        </Text>
        <Box height={1} />
        <MiniBar label="$exception" bar="████████░░░░░░░░" value="128" />
        <MiniBar label="checkout" bar="█████░░░░░░░░░░░" value="42" />
        <Box height={1} />
        <Text dimColor>prioritize by affected flow + users</Text>
      </Box>
    }
  >
    $exception events belong in product analysis too. Trend them, funnel around
    them, and prioritize bugs by the users and flows they affect.
  </SlideFrame>
);

export const InsightToActionSlide = () => (
  <SlideFrame
    visual={
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Insight loop
        </Text>
        <Box height={1} />
        <Text>
          <Text color="cyan">measure</Text>
          <Text dimColor>{' → '}</Text>
          <Text color="cyan">watch</Text>
          <Text dimColor>{' → '}</Text>
          <Text color="cyan">ask</Text>
          <Text dimColor>{' → '}</Text>
          <Text color="green">test</Text>
          <Text dimColor>{' ┐'}</Text>
        </Text>
        <Text dimColor>{'  ▲                                  │'}</Text>
        <Text>
          <Text dimColor>{'  └─ '}</Text>
          <Text color="green">guide</Text>
          <Text dimColor>{' ←─ '}</Text>
          <Text color="green">prove</Text>
          <Text dimColor>{' ───────────── ┘'}</Text>
        </Text>
      </Box>
    }
  >
    The full loop is stronger than a dashboard: measure behavior, watch replays,
    ask users, test a fix, prove revenue impact, then guide users forward.
  </SlideFrame>
);

export const CustomerContextSlide = () => (
  <SlideFrame
    visual={
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Shared context
        </Text>
        <Box height={1} />
        <Text>
          <Text color="cyan">ticket</Text>
          <Text dimColor>{'   ─┐'}</Text>
        </Text>
        <Text>
          <Text color="cyan">replay</Text>
          <Text dimColor>{'   ─┤'}</Text>
        </Text>
        <Text>
          <Text color="cyan">error</Text>
          <Text dimColor>{'    ─┼─→  '}</Text>
          <Text color="green" bold>
            user story
          </Text>
        </Text>
        <Text>
          <Text color="cyan">logs</Text>
          <Text dimColor>{'     ─┤'}</Text>
        </Text>
        <Text>
          <Text color="cyan">survey</Text>
          <Text dimColor>{'   ─┤'}</Text>
        </Text>
        <Text>
          <Text color="cyan">profile</Text>
          <Text dimColor>{'  ─┘'}</Text>
        </Text>
      </Box>
    }
  >
    Support, product, and engineering move faster when the ticket, replay,
    error, logs, user profile, and survey feedback point at the same story.
  </SlideFrame>
);
