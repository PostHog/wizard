/**
 * LearnDeckDemo — flip through every program's content deck one block at
 * a time so wording, pauses, and visual blocks can be reviewed without
 * waiting for the auto-advance timer.
 *
 *   n / p   step block (next / previous)
 *   [ / ]   switch deck
 *   r       replay current block (re-runs the reveal animation)
 *
 * Arrow keys are reserved for the playground's tab switcher, so this demo
 * uses letter keys.
 *
 * Decks are pulled from `PROGRAM_REGISTRY` so every program that ships a
 * deck is reviewable here. Migration also gets per-variant entries (one
 * per `--product=<id>` choice) so the variant composer in
 * `migration/content/index.tsx` can be exercised side-by-side with the
 * generic deck.
 */

import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import {
  ContentSequencer,
  ProgressList,
  SplitView,
  TextRevealMode,
} from '@ui/tui/primitives/index';
import type { ContentBlock, ProgressItem } from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';
import type { WizardStore } from '@ui/tui/store';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import { AUDIT_AREA_SLIDES } from '@ui/tui/screens/audit/slides/index';
import type { AreaSlide } from '@ui/tui/screens/audit/slides/shared';

interface Deck {
  id: string;
  label: string;
  blocks: ContentBlock[];
}

/**
 * Fake task list to fill the right-hand pane so the SplitView layout matches
 * what operators actually see during a real run. Mix of statuses so the
 * spinner glyph, the in-progress row, and completed rows all render.
 */
const MOCK_TASKS: ProgressItem[] = [
  {
    label: 'Confirm Statsig is in use',
    activeForm: 'Confirming Statsig is in use',
    status: 'completed',
  },
  {
    label: 'Install PostHog',
    activeForm: 'Installing PostHog',
    status: 'completed',
  },
  {
    label: 'Plan call site replacements',
    activeForm: 'Planning call site replacements',
    status: 'in_progress',
  },
  {
    label: 'Rewrite call sites',
    activeForm: 'Rewriting call sites',
    status: 'pending',
  },
  {
    label: 'Remove Statsig',
    activeForm: 'Removing Statsig',
    status: 'pending',
  },
  {
    label: 'Verify the project still builds',
    activeForm: 'Verifying the build',
    status: 'pending',
  },
  {
    label: 'Write migration report',
    activeForm: 'Writing migration report',
    status: 'pending',
  },
];

interface LearnDeckDemoProps {
  store: WizardStore;
}

export const LearnDeckDemo = ({ store }: LearnDeckDemoProps) => {
  const decks: Deck[] = useMemo(() => {
    const all: Deck[] = [];

    // Every program in the registry that ships a deck. Seed the store's
    // skillId from the program config so decks that template the skill
    // name (e.g. agent-skill's "Running the <skill> skill...") render the
    // real value instead of "unknown".
    for (const program of PROGRAM_REGISTRY) {
      if (!program.getContentBlocks) continue;
      const stub = program.skillId
        ? withSessionOverride(store, { skillId: program.skillId })
        : store;
      all.push({
        id: `program:${program.id}`,
        label: `${program.id} (${program.command ?? 'default'})${
          program.skillId ? ` · skill: ${program.skillId}` : ''
        }`,
        blocks: program.getContentBlocks(stub),
      });
    }

    // Audit ships its own per-area slide model (not the ContentBlock deck
    // most programs use). Adapt each AreaSlide into a flat ContentBlock
    // list so the flipper can review them the same way.
    all.push({
      id: 'audit:area-slides',
      label: 'audit · area slides',
      blocks: areaSlidesToBlocks(AUDIT_AREA_SLIDES),
    });

    return all;
  }, [store]);

  const [deckIdx, setDeckIdx] = useState(0);
  const [blockIdx, setBlockIdx] = useState(0);
  const [replayKey, setReplayKey] = useState(0);

  const deck = decks[deckIdx];
  const block = deck.blocks[blockIdx];

  useInput((input) => {
    if (input === 'p') {
      setBlockIdx((i) => Math.max(0, i - 1));
    } else if (input === 'n') {
      setBlockIdx((i) => Math.min(deck.blocks.length - 1, i + 1));
    } else if (input === '[') {
      setDeckIdx((i) => (i - 1 + decks.length) % decks.length);
      setBlockIdx(0);
    } else if (input === ']') {
      setDeckIdx((i) => (i + 1) % decks.length);
      setBlockIdx(0);
    } else if (input === 'r') {
      setReplayKey((k) => k + 1);
    }
  });

  const pauseMs =
    typeof block === 'object' && 'pause' in block ? block.pause : '—';
  const blockKind = describeBlockKind(block);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold color={Colors.accent}>
        Learn deck flipper
      </Text>
      <Text dimColor>n/p step block · [ ] switch deck · r replay</Text>
      <Box height={1} />

      <Text>
        <Text bold>Deck:</Text> {deck.label}{' '}
        <Text dimColor>
          ({deckIdx + 1}/{decks.length})
        </Text>
      </Text>
      <Text>
        <Text bold>Block:</Text> {blockIdx + 1}/{deck.blocks.length}{' '}
        <Text dimColor>
          · kind: {blockKind} · pause: {String(pauseMs)}ms
        </Text>
      </Text>
      <Box height={1} />

      <Box flexGrow={1}>
        <SplitView
          left={
            <ContentSequencer
              key={`${deck.id}-${blockIdx}-${replayKey}`}
              blocks={deck.blocks.slice(0, blockIdx + 1)}
              mode={TextRevealMode.SentenceBySentence}
              startDelay={0}
              initialBlockIdx={blockIdx}
            />
          }
          right={<ProgressList items={MOCK_TASKS} title="Tasks" />}
        />
      </Box>
    </Box>
  );
};

/**
 * Build a store proxy that exposes an overridden `session` while keeping
 * every prototype method (e.g. `setStatusExpanded`) and atom reference
 * intact. A plain `{...store, session: ...}` spread would drop the
 * prototype, so anything that called a store method on the result would
 * crash at render time.
 */
function withSessionOverride(
  store: WizardStore,
  patch: Partial<WizardStore['session']>,
): WizardStore {
  const stub = Object.create(Object.getPrototypeOf(store)) as WizardStore;
  Object.assign(stub, store);
  Object.defineProperty(stub, 'session', {
    value: { ...store.session, ...patch },
    writable: false,
    configurable: true,
  });
  return stub;
}

/**
 * Adapter: turn each audit AreaSlide into a sequence of ContentBlocks so it
 * fits the flipper's renderer. One block per intro paragraph, one for the
 * visual when present. Each slide is preceded by a heading block naming the
 * area so flipping between areas is obvious.
 */
function areaSlidesToBlocks(slides: AreaSlide[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const slide of slides) {
    out.push({
      content: (
        <Text bold color={Colors.accent}>
          {slide.area}
        </Text>
      ),
      pause: 3000,
    });
    for (const paragraph of slide.intro) {
      out.push({ content: paragraph, pause: 5000 });
    }
    if (slide.visual) {
      out.push({
        content: slide.visual,
        pause: 8000,
        persist: true,
      });
    }
    out.push({ type: 'clear', pause: 1000 });
  }
  return out;
}

function describeBlockKind(block: ContentBlock): string {
  if (typeof block === 'string') return 'string';
  if (typeof block === 'object' && block !== null) {
    if ('type' in block && block.type === 'clear') return 'clear';
    if ('type' in block && block.type === 'lines') return 'lines';
    if ('content' in block) {
      return typeof block.content === 'string' ? 'text' : 'jsx';
    }
  }
  return 'unknown';
}
