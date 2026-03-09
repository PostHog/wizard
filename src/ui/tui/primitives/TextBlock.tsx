/**
 * TextBlock — Animates a single string paragraph.
 *
 * Self-contained: owns its own animIdx and timer.
 * Calls onComplete() when the animation finishes.
 *
 * Five animation modes:
 *   1. Typewriter           — character-by-character reveal
 *   2. Word by word         — each word appears in order
 *   3. Sentence by sentence — sentences appear one at a time
 *   4. Paragraph fade       — paragraph appears at full opacity immediately
 *   5. Sentence fade        — paragraph dim, sentences light up in order
 */

import { Text } from 'ink';
import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { Colors } from '../styles.js';
import {
  splitSentences,
  sentenceEndChars,
  sentenceEndWords,
} from './text-helpers.js';
import { wrapAndTruncate } from './layout-helpers.js';

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

interface TextBlockProps {
  text: string;
  active: boolean;
  completed: boolean;
  onComplete: () => void;
  mode: TextRevealMode;
  bullet?: ReactNode;
  animationInterval?: number;
  sentenceInterval?: number;
  /** Max rows this block may occupy. When exceeded, top lines are truncated. */
  maxHeight?: number;
  /** Available text width in columns (for truncation wrapping). */
  availableWidth?: number;
}

export const TextBlock = ({
  text,
  active,
  completed,
  onComplete,
  mode,
  bullet,
  animationInterval,
  sentenceInterval = 1600,
  maxHeight,
  availableWidth,
}: TextBlockProps) => {
  const speed = animationInterval ?? TEXT_REVEAL_MODE_DEFAULTS[mode];

  const [animIdx, setAnimIdx] = useState(
    mode === TextRevealMode.SentenceFade ? 1 : 0,
  );

  // Reset synchronously during render to avoid a one-frame flash
  const resetRef = useRef(0);
  const prevMode = useRef(mode);
  if (prevMode.current !== mode) {
    prevMode.current = mode;
    resetRef.current += 1;
    setAnimIdx(mode === TextRevealMode.SentenceFade ? 1 : 0);
  }

  const words = text.split(/\s+/);
  const sentences = splitSentences(text);

  const sentenceCharEnds = useMemo(() => sentenceEndChars(text), [text]);
  const sentenceWordEnds = useMemo(() => sentenceEndWords(text), [text]);

  const isDone =
    mode === TextRevealMode.Typewriter
      ? animIdx >= text.length
      : mode === TextRevealMode.ParagraphFade
      ? true
      : mode === TextRevealMode.WordByWord
      ? animIdx >= words.length
      : mode === TextRevealMode.SentenceFade ||
        mode === TextRevealMode.SentenceBySentence
      ? animIdx >= sentences.length
      : true;

  // Fire onComplete when done
  useEffect(() => {
    if (isDone && active) onComplete();
  }, [isDone, active, onComplete]);

  // Animate: single effect for all tick-based modes
  useEffect(() => {
    if (!active || mode === TextRevealMode.ParagraphFade || isDone) return;
    const token = resetRef.current;

    const isFirstTick = animIdx === 0;

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
    active,
    mode,
    animIdx,
    isDone,
    speed,
    sentenceInterval,
    sentenceCharEnds,
    sentenceWordEnds,
  ]);

  // Pre-wrap text ourselves to avoid Ink's native wrap leaving leading spaces
  // on continuation lines. When maxHeight is set, also truncates to last N rows.
  const wrap = (visibleText: string): string => {
    if (availableWidth == null) return visibleText;
    if (maxHeight == null) {
      return wrapAndTruncate(visibleText, availableWidth, Infinity);
    }
    return wrapAndTruncate(visibleText, availableWidth, maxHeight);
  };

  // Completed: dimmed text
  if (completed) {
    return (
      <Text dimColor>
        {bullet}
        {wrap(text)}
      </Text>
    );
  }

  // Active: mode-specific rendering
  if (mode === TextRevealMode.Typewriter) {
    const revealed = text.slice(0, animIdx);
    const atSentenceEnd = /[.!?]\s*$/.test(revealed);
    const display = atSentenceEnd ? revealed.trimEnd() : revealed;
    return (
      <Text>
        {bullet}
        {wrap(display)}
        <Text color={Colors.muted}>{'\u258C'}</Text>
      </Text>
    );
  }

  if (mode === TextRevealMode.WordByWord) {
    const visible = words.slice(0, animIdx).join(' ');
    return (
      <Text>
        {bullet}
        {wrap(visible)}
      </Text>
    );
  }

  if (mode === TextRevealMode.ParagraphFade) {
    return (
      <Text>
        {bullet}
        {wrap(text)}
      </Text>
    );
  }

  if (mode === TextRevealMode.SentenceBySentence) {
    const visible = sentences.slice(0, animIdx).join('');
    return (
      <Text>
        {bullet}
        {wrap(visible)}
      </Text>
    );
  }

  // SentenceFade
  return (
    <Text>
      {bullet}
      {sentences.map((s, si) => (
        <Text key={si} dimColor={si >= animIdx}>
          {s}
        </Text>
      ))}
    </Text>
  );
};
