import { describe, expect, it } from 'vitest';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { PickerMenu } from '../PickerMenu.js';

/**
 * Pre-wrap a line of text at `width` characters, breaking at word boundaries.
 * Ink's Text wrap="wrap" wraps at render time *after* Yoga layout has already
 * measured the raw text height, so multi-line descriptions overflow their
 * layout cell — the next option or Confirm button renders at the wrong Y
 * offset. Pre-wrapping ensures the raw text contains \n at the actual wrap
 * points, so measureText returns the true multi-line height.
 */
function prewrap(text: string, width: number): string {
  if (!text || text.length <= width) return text;
  const lines: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (start + width >= text.length) {
      lines.push(text.slice(start));
      break;
    }
    const breakpoint = text.lastIndexOf(' ', start + width);
    const splitAt = breakpoint > start ? breakpoint : start + width;
    lines.push(text.slice(start, splitAt));
    start = splitAt + (text[splitAt] === ' ' ? 1 : 0);
  }
  return lines.join('\n');
}

describe('prewrap', () => {
  it('returns text unchanged when it fits within width', () => {
    expect(prewrap('short', 20)).toBe('short');
  });

  it('wraps at word boundary', () => {
    const result = prewrap('hello world foo bar', 11);
    const lines = result.split('\n');
    expect(lines[0]).toBe('hello world');
    expect(lines[1]).toBe('foo bar');
  });

  it('hard-breaks a word longer than width', () => {
    const result = prewrap('abcdefghijklmnop', 8);
    const lines = result.split('\n');
    expect(lines[0]).toBe('abcdefgh');
    expect(lines[1]).toBe('ijklmnop');
  });

  it('wraps long description at 56 chars', () => {
    const desc =
      "Speaks up when triaged feedback stops producing tickets at the expected rate, catching cases where a GitHub or Linear token has expired or the downstream API is down — failures that are silently swallowed and don't appear in error tracking.";
    const result = prewrap(desc, 56);
    const lines = result.split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(56);
    }
    // Should have wrapped to multiple lines
    expect(lines.length).toBeGreaterThan(1);
    // No line should overflow
    expect(lines.every((l) => l.length <= 56)).toBe(true);
  });
});

/**
 * wizard#986: a multi-select option's description used a fixed width (56)
 * regardless of the real terminal width. On a narrow terminal the rendered
 * row was wider than the physical screen, so the terminal's own line
 * wrapping (which Ink doesn't control) misaligned Ink's cursor bookkeeping
 * for every row after it — producing overlapping/corrupted text.
 *
 * ink-testing-library's Stdout always reports 100 columns with no override,
 * so these tests patch its shared prototype to drive narrower widths — the
 * same technique used to find and confirm the fix.
 */

const LONG_DESCRIPTION_OPTIONS = [
  {
    label: 'No',
    value: 'no',
    description:
      'Skip custom scouts; the built-in troop already covers this project.',
  },
  {
    label: 'Watch',
    value: 'ticket-failures',
    description:
      "Speaks up when triaged feedback stops producing tickets at the expected rate, catching cases where a GitHub or Linear token has expired or the downstream API is down — failures that are silently swallowed and don't appear in error tracking.",
  },
];

function withStdoutColumns(columns: number, run: () => void) {
  const probe = render(<Text> </Text>);
  const proto = Object.getPrototypeOf(probe.stdout);
  probe.unmount();
  const original = Object.getOwnPropertyDescriptor(proto, 'columns');
  Object.defineProperty(proto, 'columns', {
    configurable: true,
    get() {
      return columns;
    },
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(proto, 'columns', original);
  }
}

function longestLine(frame: string): number {
  return Math.max(...frame.split('\n').map((line) => line.length));
}

describe('PickerMenu multi-select — description width', () => {
  it('never renders a line wider than the terminal, even when narrow', () => {
    withStdoutColumns(40, () => {
      const { lastFrame, unmount } = render(
        <PickerMenu
          mode="multi"
          options={LONG_DESCRIPTION_OPTIONS}
          onSelect={() => undefined}
        />,
      );
      expect(longestLine(lastFrame() ?? '')).toBeLessThanOrEqual(40);
      unmount();
    });
  });

  it('scales the description width down as the terminal narrows', () => {
    const widths: number[] = [];
    for (const columns of [100, 60, 40]) {
      withStdoutColumns(columns, () => {
        const { lastFrame, unmount } = render(
          <PickerMenu
            mode="multi"
            options={LONG_DESCRIPTION_OPTIONS}
            onSelect={() => undefined}
          />,
        );
        widths.push(longestLine(lastFrame() ?? ''));
        unmount();
      });
    }
    expect(widths[1]).toBeLessThanOrEqual(widths[0]);
    expect(widths[2]).toBeLessThanOrEqual(widths[1]);
  });

  it('still caps at the original 56-character width on a wide terminal', () => {
    withStdoutColumns(200, () => {
      const { lastFrame, unmount } = render(
        <PickerMenu
          mode="multi"
          options={LONG_DESCRIPTION_OPTIONS}
          onSelect={() => undefined}
        />,
      );
      const frame = lastFrame() ?? '';
      const descriptionLines = frame
        .split('\n')
        .filter((line) => /^\s{4,}\S/.test(line) && !/^\s*$/.test(line));
      for (const line of descriptionLines) {
        expect(line.length).toBeLessThanOrEqual(64);
      }
      unmount();
    });
  });
});
