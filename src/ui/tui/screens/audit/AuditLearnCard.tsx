import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { useMemo } from 'react';
import { Colors } from '../../styles.js';
import {
  ContentSequencer,
  TextRevealMode,
  type ContentBlock,
} from '../../primitives/index.js';
import { useStdoutDimensions } from '../../hooks/useStdoutDimensions.js';
import type { AuditLearnTip } from './learnCard/index.js';

const buildTipBlocks = (tip: AuditLearnTip): ContentBlock[] => {
  const { Slide } = tip;
  return [{ content: <Slide /> }];
};

/** Open a URL in the user's default browser via the OS handler. */
const openLink = (url: string) => {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
};

interface AuditLearnCardProps {
  tip: AuditLearnTip;
  isPlaying: boolean;
  onAdvance: (direction: 1 | -1) => void;
  onTogglePlay: () => void;
}

export const AuditLearnCard = ({
  tip,
  isPlaying,
  onAdvance,
  onTogglePlay,
}: AuditLearnCardProps) => {
  const [columns, rows] = useStdoutDimensions();
  const currentLink = tip.link;

  useInput((input) => {
    const key = input.toLowerCase();
    if (key === 'n') {
      onAdvance(1);
    } else if (key === 'p') {
      onAdvance(-1);
    } else if (key === 'o' && currentLink) {
      openLink(currentLink);
    } else if (input === ' ') {
      onTogglePlay();
    }
  });

  const blocks = useMemo(() => buildTipBlocks(tip), [tip]);
  const paneWidth = Math.max(
    24,
    Math.floor((Math.min(120, columns) - 2) / 2) - 2,
  );
  const maxHeight = Math.max(6, rows - 8);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={Colors.accent}>
        Learn
      </Text>
      <Box height={1} />
      <ContentSequencer
        blocks={blocks}
        mode={TextRevealMode.SentenceBySentence}
        maxHeight={maxHeight}
        availableWidth={paneWidth}
      />
      <Box marginTop={1}>
        <Text dimColor>
          <Text color={Colors.accent}>P</Text> prev{'  '}
          <Text color={Colors.accent}>N</Text> next{'  '}
          <Text color={Colors.accent}>Space</Text>{' '}
          {isPlaying ? 'pause' : 'play'}
          {currentLink && (
            <>
              {'  '}
              <Text color={Colors.accent}>O</Text> open link
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
};
