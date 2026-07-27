import { describe, expect, it } from 'vitest';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { PickerMenu } from '../PickerMenu.js';

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
    // Monotonically non-increasing as the terminal gets narrower.
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
      // marginLeft(4) + width(<=56) = 60 is the description row's own budget;
      // the checkbox/label row and message can be shorter or longer on their
      // own terms, so we only assert the description block itself held its cap.
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
