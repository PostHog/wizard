# Responsive LearnCard Content Strategy

## The Problem

LearnCard renders ~10 content blocks sequentially via ContentSequencer. As each block completes, it stays rendered (dimmed) while the next block animates below it. The content only grows downward. Under height pressure (small terminal, expanded status bar), Ink's flexbox compresses everything — blocks crunch together, text wraps unpredictably, and the layout breaks down.

The root cause: **ContentSequencer is append-only with no awareness of available space.**

### Layout chain (top → bottom)

```
ScreenContainer          height={rows}, contentHeight = rows - 3
  └─ TabContainer        flexGrow=1
       ├─ Content area   flexGrow=1, flexShrink=1, overflow="hidden"
       │   └─ SplitView  flexGrow=1, flexShrink=1
       │        ├─ Left   width="50%", overflow="hidden"   ← LearnCard lives here
       │        └─ Right  width="50%", overflow="hidden"
       ├─ Status bar     2–10 lines (expandable)
       └─ Tab bar        height=1
```

Available height for LearnCard ≈ `rows - 3 (ScreenContainer chrome) - 3 (TabContainer chrome) - 2 (LearnCard header + spacer)` = roughly **rows - 8**.

On a 24-row terminal, that's ~16 rows. On a 40-row terminal, ~32 rows. The current content easily exceeds 16 rows once 3-4 blocks have accumulated.

---

## Design: Viewport Window with Content Eviction

**Core idea**: LearnCard maintains a fixed-height viewport. As new content animates in at the bottom, completed content is evicted from the top — like a feed that scrolls up and away.

This is NOT terminal scrolling (Ink can't do that within a flex child). Instead, ContentSequencer itself manages which blocks are visible, keeping total rendered height within a budget.

### Architecture

```
┌─────────────────────────────────┐
│  Learn about PostHog            │  ← sticky header (2 rows)
│  Text style: Typewriter [p]     │
│                                 │
│  ┌─ viewport ─────────────────┐ │
│  │ (dimmed) ...earlier block  │ │  ← oldest visible, fading out
│  │                            │ │
│  │ (dimmed) completed block   │ │  ← completed, dimmed
│  │                            │ │
│  │ ▶ active block animating.. │ │  ← currently animating
│  └────────────────────────────┘ │
│                                 │
└─────────────────────────────────┘
```

### Key decisions

**Q: Should we split into scenes / multiple LearnCards?**

No. Scenes create artificial breaks and require scene-management UI (navigation, indicators). The content is a continuous narrative — breaking it into discrete cards would feel disjointed and add complexity. Instead, one LearnCard with a viewport window achieves the same effect: the user only ever sees a comfortable amount of content, and it flows naturally.

**Q: What about terminals so small that even one block is too long?**

A single paragraph can wrap to 6-8+ lines in a narrow half-pane (~50 cols on an 80-col terminal). On a tiny terminal (e.g. 24 rows × 80 cols), we have ~16 rows of content space, and one wrapped paragraph + the header might already take 10 rows. This means:

1. **Always show at most: the active block + the one block above it (dimmed).** On small terminals, even showing 2 blocks may be tight, but this is the minimum for continuity.
2. **If the active block alone exceeds the viewport**, truncate from the top of that block (the user sees the most recently revealed text at the bottom, earlier parts scroll up). This is natural for typewriter/word-by-word modes.
3. **Below a minimum threshold** (e.g., < 6 rows of content space), hide LearnCard entirely and let the right pane (ProgressList) take full width. Educational content isn't useful if it's unreadable.

---

## Implementation Plan

### Phase 1: Height-aware ContentSequencer

**File: `ContentSequencer.tsx`**

Add a `maxHeight` prop. ContentSequencer becomes viewport-aware:

```tsx
interface ContentSequencerProps {
  blocks: ContentBlock[];
  mode: TextRevealMode;
  maxHeight?: number;        // ← NEW: row budget for visible content
  // ...existing props
}
```

**Eviction logic** — maintain a `visibleRange: [startIdx, activeIdx]`:

1. When `maxHeight` is provided, after each block completes and the next activates, estimate the total rendered height of blocks `[startIdx..activeIdx]`.
2. If total height exceeds `maxHeight`, increment `startIdx` (evict the oldest visible block).
3. Evicted blocks return `null` — they're gone from the render tree entirely.
4. The active block always renders. At most one completed block above it is kept for visual continuity (the "scrolling away" effect).

**Height estimation**: Since we can't measure rendered height before Ink lays it out, we estimate:
- String blocks: `Math.ceil(text.length / availableWidth)` rows (word-wrapped estimate)
- Lines blocks: `block.lines.length` rows
- Node blocks: count `\n` in content or use a fixed estimate (e.g., 3-4 rows)
- Add 1 row per block for `marginBottom={1}`

This is an estimate, not pixel-perfect. That's fine — the goal is "roughly fits" not "exactly fills."

### Phase 2: LearnCard passes height budget

**File: `LearnCard.tsx`**

LearnCard needs terminal dimensions to compute its height budget:

```tsx
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

const CHROME_ROWS = 8; // ScreenContainer + TabContainer + LearnCard header
const MIN_CONTENT_ROWS = 6;

export const LearnCard = () => {
  const [columns, rows] = useStdoutDimensions();
  const contentHeight = Math.max(MIN_CONTENT_ROWS, rows - CHROME_ROWS);
  const paneWidth = Math.floor((Math.min(120, columns) - 2) / 2); // half of content width

  // If terminal is too small, don't render
  if (rows - CHROME_ROWS < MIN_CONTENT_ROWS) {
    return null; // or a minimal "resize terminal" message
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* header: 2 rows */}
      <Text bold color={Colors.accent}>Learn about PostHog</Text>
      <Text dimColor>...</Text>
      <Box height={1} />
      <ContentSequencer
        blocks={CONTENT}
        mode={mode}
        maxHeight={contentHeight - 3}  // subtract header rows
        availableWidth={paneWidth - 2}  // subtract paddingX
      />
    </Box>
  );
};
```

### Phase 3: Smooth eviction transitions

When a block gets evicted, it shouldn't just vanish. Options (pick one):

**Option A: Dim → gone (simplest)**
- Completed blocks are already dimmed. When evicted, they simply stop rendering. The visual effect is: dim text was at the top, now it's gone and new content appears below. This is clean and nearly free.

**Option B: Squeeze-out animation**
- Before evicting, set the block's height to 0 over 2-3 frames (shrink it out). This creates a smooth "scrolling up" feel. More complex but visually polished.
- Implementation: add a `squeezing` state to evicted blocks, render them in a `<Box height={squeezedHeight}>` that decreases each frame, then fully remove.

**Recommendation: Start with Option A.** It's simple and already looks natural because completed blocks are dimmed — the user's eye is on the active block, not the old ones. Add Option B later if needed.

### Phase 4: Single-block overflow (very small terminals)

When even the active block exceeds `maxHeight`, we need intra-block truncation:

**For TextBlock** (typewriter/word-by-word modes):
- Only render the last N rows of revealed text, where N = maxHeight.
- The text naturally "scrolls up" as more characters/words reveal.
- Implementation: after computing `revealed` text, split by lines (accounting for word wrap at `availableWidth`), take the last `maxHeight` lines.

**For LinesBlock**:
- Only render `lines.slice(Math.max(0, revealedCount - maxHeight), revealedCount)`.
- Already a simple array slice.

**For NodeBlock**:
- Static content — if it doesn't fit, it gets clipped by `overflow="hidden"`. Acceptable.

### Phase 5: Responsive SplitView (stretch goal)

On very narrow terminals (< 80 cols), SplitView's 50/50 split gives each pane ~38 cols. This makes long paragraphs wrap excessively. Consider:

- Below 80 cols: switch to stacked layout (LearnCard on top, ProgressList below) with a configurable height split (e.g., 60/40).
- Or: hide LearnCard entirely and show only ProgressList at full width, since the primary information is task progress.

```tsx
// In SplitView or RunScreen:
const [columns] = useStdoutDimensions();
if (columns < 80) {
  return <Box flexDirection="column">{right}</Box>; // ProgressList only
}
return <SplitView left={left} right={right} />;
```

---

## Implementation Order

| Step | What | Files | Complexity |
|------|------|-------|------------|
| 1 | Add `maxHeight` + `availableWidth` props to ContentSequencer, implement block eviction | `ContentSequencer.tsx` | Medium |
| 2 | Compute height budget in LearnCard, pass to ContentSequencer | `LearnCard.tsx` | Low |
| 3 | Add height estimation helpers (text wrap row count, etc.) | `ContentSequencer.tsx` or new `layout-helpers.ts` | Low |
| 4 | Intra-block truncation for TextBlock when single block > maxHeight | `TextBlock.tsx` | Medium |
| 5 | Intra-block truncation for LinesBlock | `LinesBlock.tsx` | Low |
| 6 | Responsive SplitView collapse for narrow terminals | `SplitView.tsx`, `RunScreen.tsx` | Low |
| 7 | (Optional) Squeeze-out animation for evicted blocks | `ContentSequencer.tsx` | Medium |

---

## Height Estimation Detail

The height estimator is the linchpin. Here's the algorithm:

```ts
function estimateBlockHeight(block: ContentBlock, availableWidth: number): number {
  if (typeof block === 'string') {
    // Word-wrap estimate: split into words, accumulate line lengths
    const words = block.split(/\s+/);
    let lines = 1;
    let lineLen = 0;
    for (const word of words) {
      if (lineLen + word.length + 1 > availableWidth && lineLen > 0) {
        lines++;
        lineLen = word.length;
      } else {
        lineLen += (lineLen > 0 ? 1 : 0) + word.length;
      }
    }
    return lines + 1; // +1 for marginBottom
  }

  if (block.type === 'lines') {
    return block.lines.length + 1;
  }

  if (block.type === 'node') {
    return 4; // conservative estimate for node blocks
  }

  return 1;
}
```

This doesn't need to be perfect. Off-by-one or off-by-two is fine — the viewport is a soft constraint, and `overflow="hidden"` on the parent catches any overshoot.

### `computeVisibleRange`

Given the full block list, the active index, available width, and max height, returns `[startIdx, endIdx]` — the slice of blocks to render.

```ts
function computeVisibleRange(
  blocks: ContentBlock[],
  activeIdx: number,
  availableWidth: number,
  maxHeight: number,
): [number, number] {
  // Always include activeIdx. Walk backward adding blocks while they fit.
  let totalHeight = estimateBlockHeight(blocks[activeIdx], availableWidth);
  let start = activeIdx;

  for (let i = activeIdx - 1; i >= 0; i--) {
    const h = estimateBlockHeight(blocks[i], availableWidth);
    if (totalHeight + h > maxHeight) break;
    totalHeight += h;
    start = i;
  }

  return [start, activeIdx];
}
```

### Litmus tests (`layout-helpers.test.ts`)

These validate the eviction boundary — the most important invariant of the system.

```ts
describe('estimateBlockHeight', () => {
  it('counts wrapped lines for a short string that fits in one line', () => {
    // "Hello" at width 40 → 1 line + 1 margin = 2
    expect(estimateBlockHeight('Hello', 40)).toBe(2);
  });

  it('wraps a long paragraph into multiple lines', () => {
    // 10 words × ~5 chars + spaces ≈ 59 chars → 2 lines at width 40
    const text = 'one two three four five six seven eight nine ten';
    const height = estimateBlockHeight(text, 40);
    expect(height).toBe(3); // 2 wrapped lines + 1 margin
  });

  it('handles lines block by counting lines array length', () => {
    const block: ContentBlock = {
      type: 'lines',
      lines: [null, null, null, null, null],
    };
    // 5 lines + 1 margin = 6
    expect(estimateBlockHeight(block, 40)).toBe(6);
  });

  it('returns a fixed estimate for node blocks', () => {
    const block: ContentBlock = { type: 'node', content: null };
    const height = estimateBlockHeight(block, 40);
    expect(height).toBeGreaterThanOrEqual(2);
    expect(height).toBeLessThanOrEqual(6);
  });
});

describe('computeVisibleRange', () => {
  const blocks: ContentBlock[] = [
    'Short block one.',
    'Short block two.',
    'Short block three.',
    'Short block four.',
    'Short block five.',
  ];

  it('shows all blocks when they fit within maxHeight', () => {
    const [start, end] = computeVisibleRange(blocks, 4, 50, 100);
    expect(start).toBe(0);
    expect(end).toBe(4);
  });

  it('evicts earlier blocks when content exceeds maxHeight', () => {
    // Each short block ≈ 2 rows. 5 blocks = 10 rows. maxHeight = 6 → must evict.
    const [start, end] = computeVisibleRange(blocks, 4, 50, 6);
    expect(start).toBeGreaterThan(0);
    expect(end).toBe(4);
    // Visible blocks should fit within maxHeight
    let totalHeight = 0;
    for (let i = start; i <= end; i++) {
      totalHeight += estimateBlockHeight(blocks[i], 50);
    }
    expect(totalHeight).toBeLessThanOrEqual(6);
  });

  it('always includes the active block even if it alone exceeds maxHeight', () => {
    const bigBlocks: ContentBlock[] = ['A '.repeat(200)];
    const [start, end] = computeVisibleRange(bigBlocks, 0, 40, 4);
    expect(start).toBe(0);
    expect(end).toBe(0);
  });

  it('eviction is monotonic — start never decreases as activeIdx advances', () => {
    let prevStart = 0;
    for (let active = 0; active < blocks.length; active++) {
      const [start] = computeVisibleRange(blocks, active, 50, 6);
      expect(start).toBeGreaterThanOrEqual(prevStart);
      prevStart = start;
    }
  });
});
```

---

## What This Solves

| Problem | Solution |
|---------|----------|
| Content accumulates and compresses everything | Eviction keeps rendered content within height budget |
| Small terminal = unreadable crunch | Height-aware viewport + minimum threshold + fallback to single-pane |
| Single long block overflows | Intra-block truncation shows most recent text |
| LearnCard affects ProgressList sizing | Fixed viewport height prevents LearnCard from pushing/pulling flex siblings |
| Need for scenes/multiple cards | Unnecessary — viewport window achieves the same UX with less complexity |

## Dynamic Resize Behavior

`useStdoutDimensions()` fires on every TTY `resize` event, so `maxHeight` and `availableWidth` recompute reactively. Two edge cases matter:

**Eviction is permanent.** If the user shrinks the terminal, blocks get evicted to fit. If they enlarge it again, those blocks don't come back. This is fine — the content is a forward-flowing narrative, not a reference doc. Resurrecting old blocks would feel jarring and complicate state management (we'd need to track evicted-vs-never-rendered).

**Width changes invalidate height estimates.** A width resize changes how text wraps, which changes how many rows a block occupies. The `availableWidth` prop is already reactive (derived from `columns`), so `estimateBlockHeight` will recompute. But this means a horizontal resize could trigger eviction of a block that previously fit — or leave extra space that won't be filled until the next block advances. Both are acceptable: the viewport is a soft budget, not a pixel-perfect frame.

Eviction should re-evaluate on every render (i.e., whenever `maxHeight`, `availableWidth`, or `activeIdx` changes), not only on block transitions. This way a mid-animation resize immediately adjusts the visible range instead of waiting for the current block to complete.

## What This Doesn't Solve (and doesn't need to)

- **True scrolling / scroll-back**: Users can't scroll up to re-read evicted content. This is intentional — it's ambient educational content, not a reference document. The content is designed to flow past, not be studied.
- **Dynamic pane resizing**: The 50/50 split stays fixed. The responsive behavior is about height management, not width negotiation.
