/**
 * Source-maps learn-deck — the narrative played in the run screen's left
 * pane (LearnCard) while the agent wires source-map upload into the build.
 *
 * It educates the user on what source maps are and why uploading them
 * matters, built around a before/after stack-trace contrast: a minified
 * production trace nobody can read, then the same trace resolved back to
 * real source. Program-owned; wired onto the program's getContentBlocks.
 *
 * Lines stay narrow (~36 cols) because this renders in the left half of a
 * split pane — see LearnCard's paneWidth math.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { WizardStore } from '@ui/tui/store';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import {
  isClearBlock,
  type ContentBlock,
} from '@ui/tui/primitives/content-types';
import { StatusPeekTrigger } from '@ui/tui/components/StatusPeekTrigger';

/**
 * Per-slide dwell multiplier. Each block stays on screen for `pause * SLIDE_PACE`
 * ms after it finishes animating, before the deck advances. Bump this single
 * knob to give every slide more reading time. Clear (page-break) blocks are
 * left untouched so the blank gap between slides stays snappy.
 */
const SLIDE_PACE = 1.5;

const withPace = (block: ContentBlock): ContentBlock => {
  if (typeof block === 'string' || isClearBlock(block) || block.pause == null) {
    return block;
  }
  return { ...block, pause: Math.round(block.pause * SLIDE_PACE) };
};

/** Apply the dwell multiplier to every block in a deck. */
const pace = (blocks: ContentBlock[]): ContentBlock[] => blocks.map(withPace);

/**
 * A minified production stack trace — the problem source maps solve. Framed as
 * a labelled, muted example (no error-red ✘) so a glance reads it as
 * illustrative content, not as the wizard itself having errored mid-run.
 */
const MINIFIED_TRACE: ContentBlock = {
  type: 'lines',
  interval: 400,
  pause: 7000,
  lines: [
    <Text dimColor>{'example — minified production trace'}</Text>,
    <Text color={Colors.muted}>{'  TypeError: cart is undefined'}</Text>,
    <Text dimColor>{'    at t.min.js:1:48213'}</Text>,
    <Text dimColor>{'    at t.min.js:1:9402'}</Text>,
    <Text dimColor>{'    at t.min.js:1:71150'}</Text>,
  ],
};

/** The same trace, resolved through uploaded source maps. */
const RESOLVED_TRACE: ContentBlock = {
  type: 'lines',
  interval: 400,
  pause: 8000,
  lines: [
    <Text dimColor>{'example — resolved with source maps'}</Text>,
    <Text color={Colors.success}>{'  ✔ TypeError: cart is undefined'}</Text>,
    <Text>
      <Text dimColor>{'    at '}</Text>
      <Text color="cyan">Cart.tsx:42</Text>
      <Text dimColor>{'  loadCart'}</Text>
    </Text>,
    <Text>
      <Text dimColor>{'    at '}</Text>
      <Text color="cyan">App.tsx:88</Text>
      <Text dimColor>{'   render'}</Text>
    </Text>,
    <Text>
      <Text dimColor>{'    at '}</Text>
      <Text color="cyan">index.tsx:5</Text>
      <Text dimColor>{'  main'}</Text>
    </Text>,
  ],
};

/**
 * How a bundle is tied to its map: PostHog injects a chunk-ID marker into the
 * built JS and stamps the matching source map with the same ID.
 */
const CHUNK_ID_LINK: ContentBlock = {
  type: 'lines',
  interval: 450,
  pause: 7500,
  lines: [
    <Text dimColor>app.min.js</Text>,
    <Text dimColor>{'  …minified code…'}</Text>,
    <Text>
      <Text color="cyan">{'  //# chunkId=a1b2c3d4'}</Text>
      <Text dimColor>{'  ← injected'}</Text>
    </Text>,
    <Text dimColor>{'        ↕  matched by id'}</Text>,
    <Text>
      <Text dimColor>app.min.js.map</Text>
      <Text dimColor>{'  ← uploaded'}</Text>
    </Text>,
  ],
};

/** Many similar exceptions collapse into a single issue. */
const GROUPING: ContentBlock = {
  type: 'lines',
  interval: 450,
  pause: 7000,
  lines: [
    <Text dimColor>{'exception ─┐'}</Text>,
    <Text>
      <Text dimColor>{'exception ─┼──→ '}</Text>
      <Text color={Colors.accent} bold>
        1 issue
      </Text>
    </Text>,
    <Text dimColor>{'exception ─┘'}</Text>,
  ],
};

export const getContentBlocks = (store?: WizardStore): ContentBlock[] =>
  pace([
    {
      content: 'Welcome.',
      pause: 3000,
      mode: TextRevealMode.Typewriter,
      animationInterval: 160,
    },

    {
      content: "I'm wiring PostHog Error Tracking into your build.",
      pause: 5000,
    },

    { type: 'clear', pause: 1500 },

    {
      content: 'When you ship to production, your code gets minified.',
      pause: 5000,
    },
    {
      content: 'Thousands of readable lines collapse into one dense bundle.',
      pause: 5000,
    },
    {
      content: 'So a thrown error gives you a stack trace like this:',
      pause: 2000,
    },

    MINIFIED_TRACE,

    { content: 'Just offsets into a file no human can read.', pause: 5000 },

    { type: 'clear', pause: 1500 },

    { content: 'Source maps are the key.', pause: 3500 },
    {
      content:
        'They map every position in that bundle back to your original source — the real file, line, and function.',
      pause: 6000,
    },
    {
      content:
        "Right now I'm hooking source-map generation and upload into your build, tied to each release you ship.",
      pause: 6000,
    },

    { type: 'clear', pause: 1500 },

    {
      content: 'But how does PostHog know which map belongs to which build?',
      pause: 4500,
    },
    {
      content:
        'During the build, it injects a unique chunk ID into each bundle:',
      pause: 2500,
    },

    CHUNK_ID_LINK,

    {
      content:
        'The matching source map is stamped with that same ID before it ships to PostHog.',
      pause: 6000,
    },
    {
      content:
        'When an error comes in, PostHog reads the chunk ID off the bundle, finds the map with the exact same ID, and uses it to map each frame back to your source — even for a release you shipped weeks ago.',
      pause: 8000,
    },

    { type: 'clear', pause: 1500 },

    { content: 'So that same error becomes:', pause: 2000 },

    RESOLVED_TRACE,

    {
      content: 'Readable stack traces, straight from production.',
      pause: 5000,
    },
    {
      content: 'You debug a live error like it happened on your own machine.',
      pause: 6000,
    },

    { type: 'clear', pause: 1500 },

    { content: 'Zooming out — this is how Error Tracking works.', pause: 4000 },
    {
      content: 'Every error your app throws is captured as an exception.',
      pause: 5000,
    },
    {
      content: 'PostHog groups similar exceptions into a single issue:',
      pause: 2500,
    },

    GROUPING,

    {
      content:
        'So a bug that fires ten thousand times is one issue to triage — not ten thousand alerts.',
      pause: 6500,
    },

    { type: 'clear', pause: 1500 },

    {
      content: 'And this is where source maps earn their keep again.',
      pause: 4500,
    },
    {
      content:
        'Grouping reads the stack trace. Minified frames all look alike — so unrelated crashes get merged, and one real bug scatters across many issues.',
      pause: 8000,
    },
    {
      content:
        'With source maps, PostHog groups on your real frames — so each distinct bug lands as one clean issue.',
      pause: 7000,
    },

    { type: 'clear', pause: 1500 },

    {
      pause: 5000,
      persist: true,
      content: <StatusPeekTrigger store={store} />,
    },
    {
      pause: 90000,
      content: (
        <Text>
          Press{' '}
          <Text color={Colors.accent} bold>
            S
          </Text>{' '}
          to follow along — or sit tight, I'll let you know when it's done.
        </Text>
      ),
    },
  ]);
