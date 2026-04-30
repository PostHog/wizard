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

/**
 * Module-level slideshow state survives unmount/remount (e.g. when the user
 * switches tabs). Without this, the 15s auto-advance timer would reset every
 * time the Status tab loses focus.
 *
 * `currentTipStartedAt` records when the active slide was first shown
 * (in playing time). On pause we snapshot how much had elapsed; on resume
 * we shift the timestamp so the elapsed time picks up where it left off.
 */
let savedTipIndex = 0;
let savedIsPlaying = true;
let currentTipStartedAt = Date.now();
let pausedElapsed: number | null = null;

const elapsedSinceCurrentTip = (): number => {
  if (pausedElapsed != null) return pausedElapsed;
  return Date.now() - currentTipStartedAt;
};

export const AuditLearnCard = () => {
  const [tipIndex, setTipIndexState] = useState(savedTipIndex);
  const [isPlaying, setIsPlayingState] = useState(savedIsPlaying);
  const [columns, rows] = useStdoutDimensions();

  const setTipIndex = useCallback((next: (current: number) => number) => {
    setTipIndexState((current) => {
      const computed = next(current);
      savedTipIndex = computed;
      currentTipStartedAt = Date.now();
      pausedElapsed = null;
      return computed;
    });
  }, []);

  const setIsPlaying = useCallback((next: (current: boolean) => boolean) => {
    setIsPlayingState((current) => {
      const computed = next(current);
      if (computed && !current) {
        // Resume: shift start so already-elapsed time is preserved.
        currentTipStartedAt = Date.now() - (pausedElapsed ?? 0);
        pausedElapsed = null;
      } else if (!computed && current) {
        // Pause: snapshot elapsed.
        pausedElapsed = Date.now() - currentTipStartedAt;
      }
      savedIsPlaying = computed;
      return computed;
    });
  }, []);

  const advanceTip = useCallback(
    (direction: 1 | -1) => {
      setTipIndex((current) => wrapTipIndex(current + direction));
    },
    [setTipIndex],
  );

  const takeOverSlideshow = useCallback(
    (direction: 1 | -1) => {
      setIsPlaying(() => false);
      advanceTip(direction);
    },
    [advanceTip, setIsPlaying],
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
    const remaining = Math.max(0, TIP_DURATION_MS - elapsedSinceCurrentTip());
    const timer = setTimeout(() => advanceTip(1), remaining);
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
