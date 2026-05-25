/**
 * LearnCard — Generic render shell for an animated content deck.
 *
 * Program-owned. Callers pass the script via `blocks`. The script lives
 * under `src/lib/programs/<name>/content/`. The shell handles
 * dimension tracking, status-bar height math, and the `display="none"`
 * clamp on narrow terminals.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';
import type { WizardStore } from '../store.js';
import { ContentSequencer, TextRevealMode } from '../primitives/index.js';
import type { ContentBlock } from '../primitives/index.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { COLLAPSED_COUNT, EXPANDED_COUNT } from '../primitives/TabContainer.js';

/** Fixed chrome: ScreenContainer (3) + TabContainer tab bar (2) */
const FIXED_CHROME = 5;
const HEADER_ROWS = 2; // title + spacer
const MIN_CONTENT_ROWS = 6;

interface LearnCardProps {
  store?: WizardStore;
  /** The script to play. Program-owned; see programs/<name>/content/. */
  blocks: ContentBlock[];
  onComplete?: () => void;
}

export const LearnCard = ({ store, blocks, onComplete }: LearnCardProps) => {
  const [columns, rows] = useStdoutDimensions();

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
        initialBlockIdx={store?.learnCardBlockIdx ?? 0}
        onBlockChange={(idx) => store?.setLearnCardBlockIdx(idx)}
        onSequenceComplete={onComplete}
      />
    </Box>
  );
};
