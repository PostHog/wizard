/**
 * Logs learn deck. Four movements:
 *
 *   1. Welcome and orient — what the agent is doing right now.
 *   2. The pitch — why logs belong next to the rest of your product data,
 *      drawn as the correlation chain rather than asserted.
 *   3. What to expect from this run — additive, one attachment point, and an
 *      honest report about how far correlation actually got.
 *   4. Logging practices worth knowing, paraphrased from the public docs.
 *
 * Logging guidance paraphrased from PostHog public docs:
 *   - posthog.com/docs/logs/best-practices
 *   - posthog.com/docs/logs/link-session-replay
 */

import { Text } from 'ink';
import type { WizardStore } from '@ui/tui/store';
import { Colors } from '@ui/tui/styles';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import { StatusPeekTrigger } from '@ui/tui/components/StatusPeekTrigger';
import { CORRELATION_BLOCK } from './correlation-diagram.js';

export const getContentBlocks = (store?: WizardStore): ContentBlock[] => [
  // ── Welcome ────────────────────────────────────────────────────────────
  {
    content: 'Hello.',
    pause: 3000,
    mode: TextRevealMode.Typewriter,
    animationInterval: 160,
  },

  { content: 'The Wizard is an agent.', pause: 4000 },

  {
    content: 'Right now it’s reading how your app logs today.',
    pause: 5000,
  },

  {
    content: 'PostHog covers the cost of running this agent.',
    pause: 4000,
  },

  { type: 'clear', pause: 2000 },

  {
    pause: 5000,
    persist: true,
    content: <StatusPeekTrigger store={store} />,
  },

  {
    pause: 6000,
    persist: true,
    content: (
      <Text>
        Press{' '}
        <Text color={Colors.accent} bold>
          S
        </Text>{' '}
        to expand or collapse the status.
      </Text>
    ),
  },

  { type: 'clear', pause: 2000 },

  // ── Why logs here ──────────────────────────────────────────────────────
  {
    content: 'You already have somewhere to put logs.',
    pause: 4000,
  },

  {
    content: 'So here’s what’s different about putting them here.',
    pause: 4500,
  },

  {
    content:
      'A log line on its own tells you what broke. It rarely tells you who it broke for, or what they did to break it.',
    pause: 7000,
  },

  { content: 'Two attributes fix that.', pause: 3000 },

  CORRELATION_BLOCK,

  { type: 'clear', pause: 1500 },

  {
    content:
      'That’s the whole idea. Your logs stop being a separate place you go, and start being part of the story of a user’s session.',
    pause: 7000,
  },

  {
    content:
      'Attaching those two attributes is most of what the agent is doing right now.',
    pause: 5500,
  },

  { type: 'clear', pause: 1500 },

  // ── What to expect ─────────────────────────────────────────────────────
  { content: 'Here’s what to expect.', pause: 3000 },

  {
    content:
      'Your existing logging keeps working. Same library, same levels, same messages.',
    pause: 6000,
  },

  {
    content:
      'The agent adds a second destination alongside it, then finds where your app already knows who the user is.',
    pause: 6500,
  },

  {
    content:
      'That last part is why this is an agent and not a copy-paste snippet. Identity lives somewhere different in every codebase.',
    pause: 7000,
  },

  {
    content:
      'It attaches identity in one place, so a codebase with two hundred log statements ends up with two hundred correlated ones.',
    pause: 7000,
  },

  {
    content:
      'Some code can’t reach a user at all — background jobs, cron, startup. Those stay uncorrelated, and the report says so.',
    pause: 7000,
  },

  {
    content:
      'Nothing gets committed. You review the diff and the report at the end.',
    pause: 5500,
  },

  { type: 'clear', pause: 1500 },

  // ── Practices ──────────────────────────────────────────────────────────
  {
    content: (
      <Text bold color={Colors.accent}>
        Worth knowing
      </Text>
    ),
    pause: 2500,
    persist: true,
  },

  {
    content:
      'Log structured fields, not sentences. Searching a field beats grepping a string.',
    pause: 6000,
  },

  {
    content: (
      <Text>
        Put the identifiers in attributes —{' '}
        <Text bold color={Colors.accent}>
          order_id
        </Text>
        ,{' '}
        <Text bold color={Colors.accent}>
          endpoint
        </Text>
        , duration. That’s what you’ll filter on at 3am.
      </Text>
    ),
    pause: 7000,
    persist: true,
  },

  {
    content:
      'Keep levels honest. If everything is an error, nothing is. Warnings you never act on are noise you pay to store.',
    pause: 7000,
  },

  {
    content:
      'Never log secrets, tokens, or full request bodies. Logs are searchable by everyone on your team, which is the point.',
    pause: 7000,
  },

  { type: 'clear', pause: 1500 },

  // ── Close ──────────────────────────────────────────────────────────────
  {
    content:
      'When this finishes, open a log line in PostHog and press View recording.',
    pause: 5500,
  },

  {
    content: (
      <Text>
        Then watch the session that produced it.{'\n'}
        <Text dimColor>https://posthog.com/docs/logs</Text>
      </Text>
    ),
    pause: 6500,
    persist: true,
  },
];
