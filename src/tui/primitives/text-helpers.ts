/**
 * Text-splitting helpers for sentence boundary detection.
 * Used by TextBlock for animation pauses at punctuation.
 */

/** Split text into sentences (keeps the delimiter attached) */
export function splitSentences(text: string): string[] {
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
export function sentenceEndChars(text: string): Set<number> {
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
export function sentenceEndWords(text: string): Set<number> {
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
