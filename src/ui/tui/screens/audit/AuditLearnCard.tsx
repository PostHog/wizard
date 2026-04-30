import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Colors } from '../../styles.js';
import {
  ContentSequencer,
  TextRevealMode,
  type ContentBlock,
} from '../../primitives/index.js';
import { useStdoutDimensions } from '../../hooks/useStdoutDimensions.js';
import { AUDIT_LEARN_TIPS } from './learnCard/index.js';

const TIP_DURATION_MS = 15_000;

const wrapTipIndex = (index: number): number =>
  (index + AUDIT_LEARN_TIPS.length) % AUDIT_LEARN_TIPS.length;

const buildTipBlocks = (tipIndex: number): ContentBlock[] => {
  const { Slide } = AUDIT_LEARN_TIPS[tipIndex];
  return [
    {
      content: <Slide />,
    },
  ];
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

export const AuditLearnCard = () => {
  const [tipIndex, setTipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [columns, rows] = useStdoutDimensions();

  const advanceTip = useCallback((direction: 1 | -1) => {
    setTipIndex((current) => wrapTipIndex(current + direction));
  }, []);

  const takeOverSlideshow = useCallback(
    (direction: 1 | -1) => {
      setIsPlaying(false);
      advanceTip(direction);
    },
    [advanceTip],
  );

  const currentLink = AUDIT_LEARN_TIPS[tipIndex]?.link;

  useInput((input) => {
    const key = input.toLowerCase();
    if (key === 'n') {
      takeOverSlideshow(1);
    } else if (key === 'p') {
      takeOverSlideshow(-1);
    } else if (key === 'o' && currentLink) {
      openLink(currentLink);
    } else if (input === ' ') {
      setIsPlaying((playing) => !playing);
    }
  });

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setTimeout(() => advanceTip(1), TIP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [advanceTip, isPlaying, tipIndex]);

  const blocks = useMemo(() => buildTipBlocks(tipIndex), [tipIndex]);
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
        key={tipIndex}
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
