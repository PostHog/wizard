/**
 * TextReveal — Primitive that animates paragraphs of text sequentially.
 *
 * Five animation modes:
 *   1. Word-by-word        — each word appears in order
 *   2. Typewriter           — character-by-character reveal
 *   3. Sentence by sentence — sentences appear one at a time
 *   4. Paragraph fade       — paragraph appears at full opacity, previous ones dim
 *   5. Sentence fade        — paragraph dim, sentences light up in order
 *
 * Three interval props:
 *   - `animationInterval` — per-tick speed (per word / per char / per sentence depending on mode)
 *   - `sentenceInterval`  — extra pause at sentence boundaries (WordByWord & Typewriter only)
 *   - `paragraphInterval` — gap between paragraphs after one finishes animating
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Colors, Icons } from '../styles.js';

export enum TextRevealMode {
  Typewriter = 0,
  WordByWord = 1,
  SentenceBySentence = 2,
  ParagraphFade = 3,
  SentenceFade = 4,
}

export const TEXT_REVEAL_MODE_LABELS = [
  'Typewriter',
  'Word by word',
  'Sentence by sentence',
  'Paragraph fade',
  'Sentence fade',
];

export const TEXT_REVEAL_MODE_COUNT = 5;

/** Default interval per mode (ms) */
export const TEXT_REVEAL_MODE_DEFAULTS: Record<TextRevealMode, number> = {
  [TextRevealMode.WordByWord]: 240,
  [TextRevealMode.Typewriter]: 32,
  [TextRevealMode.SentenceBySentence]: 1800,
  [TextRevealMode.ParagraphFade]: 4800,
  [TextRevealMode.SentenceFade]: 2400,
};

interface TextRevealProps {
  /** The paragraphs to animate through */
  paragraphs: string[];
  /** Which animation mode to use */
  mode: TextRevealMode;
  /** Animation speed for the current mode — meaning depends on mode */
  animationInterval?: number;
  /** Extra pause at sentence boundaries — only for WordByWord & Typewriter (default 800) */
  sentenceInterval?: number;
  /** ms between paragraphs after one finishes animating (default 2400) */
  paragraphInterval?: number;
}

/** Split text into sentences (keeps the delimiter attached) */
function splitSentences(text: string): string[] {
  const parts: string[] = [];
  const re = /[^.!?]*[.!?]+\s*/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = re.exec(text)) !== null) {
    parts.push(match[0]);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/** Build a set of character indices where sentences end (for typewriter pause) */
function sentenceEndChars(text: string): Set<number> {
  const ends = new Set<number>();
  const sentences = splitSentences(text);
  let pos = 0;
  for (const s of sentences) {
    pos += s.length;
    ends.add(pos - 1);
  }
  return ends;
}

/** Build a set of word indices where sentences end (for word-by-word pause) */
function sentenceEndWords(text: string): Set<number> {
  const ends = new Set<number>();
  const sentences = splitSentences(text);
  let wordCount = 0;
  for (const s of sentences) {
    const words = s.trim().split(/\s+/).filter(Boolean);
    wordCount += words.length;
    ends.add(wordCount - 1);
  }
  return ends;
}

export const TextReveal = ({
  paragraphs,
  mode,
  animationInterval,
  sentenceInterval = 1600,
  paragraphInterval = 3200,
}: TextRevealProps) => {
  const speed = animationInterval ?? TEXT_REVEAL_MODE_DEFAULTS[mode];

  const [activeIdx, setActiveIdx] = useState(0);
  const [animIdx, setAnimIdx] = useState(0);

  // Reset synchronously during render to avoid a one-frame flash
  // of the full paragraph before the animation starts.
  const resetRef = useRef(0);
  const prevActiveIdx = useRef(activeIdx);
  const prevMode = useRef(mode);
  if (prevActiveIdx.current !== activeIdx || prevMode.current !== mode) {
    prevActiveIdx.current = activeIdx;
    prevMode.current = mode;
    resetRef.current += 1;
    // Sentence fade starts with first sentence already lit
    setAnimIdx(mode === TextRevealMode.SentenceFade ? 1 : 0);
  }

  const currentText = paragraphs[activeIdx] ?? '';
  const currentWords = currentText.split(/\s+/);
  const currentSentences = splitSentences(currentText);

  // Pre-compute sentence boundary indices for the current paragraph
  const sentenceCharEnds = useMemo(
    () => sentenceEndChars(currentText),
    [currentText],
  );
  const sentenceWordEnds = useMemo(
    () => sentenceEndWords(currentText),
    [currentText],
  );

  const isDone =
    mode === TextRevealMode.Typewriter
      ? animIdx >= currentText.length
      : mode === TextRevealMode.ParagraphFade
      ? true
      : mode === TextRevealMode.WordByWord
      ? animIdx >= currentWords.length
      : mode === TextRevealMode.SentenceFade ||
        mode === TextRevealMode.SentenceBySentence
      ? animIdx >= currentSentences.length
      : true;

  // Advance to next paragraph
  useEffect(() => {
    if (activeIdx >= paragraphs.length - 1) return;
    if (!isDone) return;
    // ParagraphFade uses its own speed as the reveal gap
    const gap =
      mode === TextRevealMode.ParagraphFade ? speed : paragraphInterval;
    const timer = setTimeout(() => {
      setActiveIdx((c) => c + 1);
    }, gap);
    return () => clearTimeout(timer);
  }, [activeIdx, mode, isDone, paragraphInterval, paragraphs.length, speed]);

  // Animate: single effect for all tick-based modes
  useEffect(() => {
    if (mode === TextRevealMode.ParagraphFade || isDone) return;
    const token = resetRef.current;

    // First tick ever — start immediately, no delay
    const isFirstTick = activeIdx === 0 && animIdx === 0;

    // Determine if we just landed on a sentence boundary
    let delay = isFirstTick ? 0 : speed;
    if (
      !isFirstTick &&
      mode === TextRevealMode.Typewriter &&
      animIdx > 0 &&
      sentenceCharEnds.has(animIdx - 1)
    ) {
      delay = sentenceInterval;
    } else if (
      !isFirstTick &&
      mode === TextRevealMode.WordByWord &&
      animIdx > 0 &&
      sentenceWordEnds.has(animIdx - 1)
    ) {
      delay = sentenceInterval;
    }

    const timer = setTimeout(() => {
      if (token !== resetRef.current) return;
      setAnimIdx((c) => c + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [
    mode,
    activeIdx,
    animIdx,
    isDone,
    speed,
    sentenceInterval,
    sentenceCharEnds,
    sentenceWordEnds,
  ]);

  return (
    <Box flexDirection="column">
      {paragraphs.map((text, i) => {
        if (i > activeIdx) return null;

        const isCompleted = i < activeIdx;

        if (isCompleted) {
          return (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text dimColor>
                <Text color={Colors.accent}>{Icons.diamondOpen} </Text>
                {text}
              </Text>
            </Box>
          );
        }

        // Active paragraph
        if (mode === TextRevealMode.Typewriter) {
          const revealed = text.slice(0, animIdx);
          const atSentenceEnd = /[.!?]\s*$/.test(revealed);
          return (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text>
                <Text color={Colors.accent}>{Icons.diamond} </Text>
                {atSentenceEnd ? revealed.trimEnd() : revealed}
                <Text color={Colors.muted}>{'\u258C'}</Text>
              </Text>
            </Box>
          );
        }

        if (mode === TextRevealMode.WordByWord) {
          const words = text.split(/\s+/);
          const visible = words.slice(0, animIdx).join(' ');
          return (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text>
                <Text color={Colors.accent}>{Icons.diamond} </Text>
                {visible}
              </Text>
            </Box>
          );
        }

        if (mode === TextRevealMode.ParagraphFade) {
          return (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text>
                <Text color={Colors.accent}>{Icons.diamond} </Text>
                {text}
              </Text>
            </Box>
          );
        }

        // SentenceBySentence — sentences appear one at a time, hidden until revealed
        if (mode === TextRevealMode.SentenceBySentence) {
          const sentences = splitSentences(text);
          const visible = sentences.slice(0, animIdx).join('');
          return (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text>
                <Text color={Colors.accent}>{Icons.diamond} </Text>
                {visible}
              </Text>
            </Box>
          );
        }

        // SentenceFade — whole paragraph dim, sentences light up in order
        const sentences = splitSentences(text);
        return (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={Colors.accent}>
                {animIdx >= sentences.length
                  ? Icons.diamond
                  : Icons.diamondOpen}{' '}
              </Text>
              {sentences.map((s, si) => (
                <Text key={si} dimColor={si >= animIdx}>
                  {s}
                </Text>
              ))}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
