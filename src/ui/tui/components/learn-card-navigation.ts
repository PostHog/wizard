import type { ContentBlock } from '../primitives/content-types.js';
import { isClearBlock } from '../primitives/content-types.js';

export function getLearnSectionStartIndices(blocks: ContentBlock[]): number[] {
  const starts: number[] = [];
  let nextBlockStartsSection = true;

  for (const [idx, block] of blocks.entries()) {
    if (isClearBlock(block)) {
      nextBlockStartsSection = true;
      continue;
    }

    if (nextBlockStartsSection) {
      starts.push(idx);
      nextBlockStartsSection = false;
    }
  }

  return starts;
}

export function getLearnSectionIndex(
  sectionStarts: number[],
  blockIdx: number,
): number {
  if (sectionStarts.length === 0) return 0;

  let sectionIdx = 0;
  for (const [idx, start] of sectionStarts.entries()) {
    if (start > blockIdx) break;
    sectionIdx = idx;
  }

  return sectionIdx;
}
