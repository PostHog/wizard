/**
 * PickerMenu — Single and multi select.
 * Single mode: custom renderer with small triangle indicator; enter selects.
 * Multi mode: checkbox glyphs toggled with enter, plus a focusable
 *   Confirm button below the options. The cursor moves onto the button and
 *   enter submits — see MultiPickerMenu for the rationale.
 *
 * Key bindings are declared via useKeyBindings, which auto-registers
 * hints in the KeyboardHintsBar.
 */

import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { Icons, Colors } from '@ui/tui/styles';
import { PromptLabel } from './PromptLabel.js';
import { ConfirmButton } from './ConfirmButton.js';
import { wordWrap } from './layout-helpers.js';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import {
  useKeyBindings,
  KeyMatch,
  type KeyBinding,
  type KeyMatchOrChar,
} from '@ui/tui/hooks/useKeyBindings';

interface PickerOption<T> {
  label: string;
  value: T;
  hint?: string;
  /**
   * Multi-select only: a secondary explanation rendered dimmed and wrapped on
   * its own line(s) beneath the label, for choices that need more than a title.
   * When unset, the row renders exactly as a label-only row.
   */
  description?: string;
  /** Glyph rendered before the label, in its own color — unaffected by
   *  focus and disabled styling. */
  icon?: { glyph: string; color?: string };
  /** Dimmed and unselectable; navigation skips over it. */
  disabled?: boolean;
  /**
   * Section heading: unselectable (navigation skips it, like `disabled`) but
   * rendered as a bold header rather than a muted row. Set `disabled` too so
   * the skip logic treats it as non-selectable.
   */
  header?: boolean;
  /** Indent the label one level, e.g. items nested under a `header` row. */
  indent?: boolean;
  /**
   * Multi-select only: marks this option mutually exclusive with every other
   * option. Selecting it clears all other picks; selecting any non-exclusive
   * option clears it. Used e.g. for a browser connector that can't be
   * installed alongside local editors.
   */
  exclusive?: boolean;
}

/**
 * Step through a column's options in `dir`, wrapping, until an enabled
 * option is found. Returns `from` unchanged if the column is entirely
 * disabled.
 */
function stepEnabled<T>(
  options: PickerOption<T>[],
  rows: number,
  from: number,
  dir: 1 | -1,
): number {
  const col = Math.floor(from / rows);
  const colStart = col * rows;
  const colLen = Math.min(rows, options.length - colStart);
  let row = from % rows;
  for (let i = 0; i < colLen; i++) {
    row = (row + dir + colLen) % colLen;
    const idx = colStart + row;
    if (!options[idx]?.disabled) return idx;
  }
  return from;
}

/** Index of the first enabled option, for the initial focus. */
function firstEnabled<T>(options: PickerOption<T>[]): number {
  const idx = options.findIndex((o) => !o.disabled);
  return idx === -1 ? 0 : idx;
}

/** Index of the last enabled option, for wrapping from the button onto
 *  the bottom of the grid. */
function lastEnabled<T>(options: PickerOption<T>[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if (!options[i]?.disabled) return i;
  }
  return options.length - 1;
}

/**
 * Rows the surrounding screen or overlay consumes above and below a picker —
 * border + padding, title, prompt text, and the keyboard-hints bar. A
 * deliberately generous estimate: overshooting just shows a few fewer rows,
 * whereas undershooting lets a long list overflow the viewport (the bug this
 * windowing guards against). Mirrors GroupedPickerMenu's budgeting.
 */
const CHROME_OVERHEAD = 13;
/**
 * Max visual rows a picker renders regardless of terminal height. Without a
 * ceiling a tall terminal lets a long list fill the whole viewport, which
 * reads as a wall of options; ~12 rows keeps the menu scannable and leaves
 * known breathing room above and below.
 */
const MAX_LIST_ROWS = 12;
/** Extra rows a multi-select adds below its options: marginTop + Confirm button. */
const CONFIRM_CHROME = 3;
/** Width the multi-select wraps option descriptions to (matches the render). */
const DESCRIPTION_WIDTH = 56;

interface PickerViewport {
  needsScroll: boolean;
  /** First option index on the current page. */
  start: number;
  /** One past the last option index on the current page. */
  end: number;
  hiddenAbove: number;
  hiddenBelow: number;
  /** Focus target one page over (wrapping), for the n/p keys. */
  pageStep: (focused: number, dir: 1 | -1) => number;
}

/**
 * Pages a single-column option list to the terminal height. The visible page
 * is derived from the focused index — no scroll state — so ↑/↓ flip pages as
 * focus crosses a page edge and n/p jump a whole page. Pages hold a fixed
 * option count sized to the tallest row (`rowCost`), trading a sparser page
 * on mixed-height lists for arithmetic-only paging. Engages only for
 * single-column pickers — multi-column grids already compress vertically.
 */
function usePickerViewport(
  count: number,
  rowCost: number,
  chromeBelow: number,
  enabled: boolean,
  focused: number,
): PickerViewport {
  const [, termRows] = useStdoutDimensions();
  const budget = Math.max(
    5,
    Math.min(termRows - CHROME_OVERHEAD - chromeBelow, MAX_LIST_ROWS),
  );
  const needsScroll = enabled && count * rowCost > budget;
  // Reserve two rows for the "↑/↓ N more" indicators.
  const perPage = needsScroll
    ? Math.max(1, Math.floor((budget - 2) / rowCost))
    : count;
  const pageCount = Math.max(1, Math.ceil(count / perPage));
  const start = Math.floor(focused / perPage) * perPage;
  const end = Math.min(start + perPage, count);
  return {
    needsScroll,
    start,
    end,
    hiddenAbove: start,
    hiddenBelow: count - end,
    pageStep: (f, dir) =>
      ((Math.floor(f / perPage) + dir + pageCount) % pageCount) * perPage,
  };
}

interface PickerMenuProps<T> {
  message?: string;
  options: PickerOption<T>[];
  mode?: 'single' | 'multi';
  centered?: boolean;
  columns?: 1 | 2 | 3 | 4;
  /**
   * Vertical space between options, in TUI rows. Defaults to 0 — i.e.
   * options stack tightly. Set to 1+ when the option labels are long
   * (wrap across multiple lines) or for visual breathing room.
   */
  optionMarginBottom?: number;
  onSelect: (value: T | T[]) => void;
}

export const PickerMenu = <T,>({
  message,
  options,
  mode = 'single',
  centered = false,
  columns = 1,
  optionMarginBottom = 0,
  onSelect,
}: PickerMenuProps<T>) => {
  if (mode === 'multi') {
    return (
      <MultiPickerMenu
        message={message}
        options={options}
        centered={centered}
        columns={columns}
        optionMarginBottom={optionMarginBottom}
        onSelect={onSelect}
      />
    );
  }

  return (
    <SinglePickerMenu
      message={message}
      options={options}
      centered={centered}
      columns={columns}
      optionMarginBottom={optionMarginBottom}
      onSelect={onSelect}
    />
  );
};

/** Custom single-select with triangle indicator and accent highlight. */
const SinglePickerMenu = <T,>({
  message,
  options,
  centered = false,
  columns = 1,
  optionMarginBottom = 0,
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  optionMarginBottom?: number;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(() => firstEnabled(options));
  const rows = Math.ceil(options.length / columns);
  // Single-select rows are label-only (no descriptions): one line plus margin.
  const viewport = usePickerViewport(
    options.length,
    1 + optionMarginBottom,
    0,
    columns === 1,
    focused,
  );

  // Re-validate focus when the options change while mounted \u2014 a list
  // that shrinks or disables entries can leave `focused` pointing at a
  // missing or disabled option, which would make enter a no-op.
  useEffect(() => {
    if (focused >= options.length || options[focused]?.disabled) {
      setFocused(firstEnabled(options));
    }
  }, [options, focused]);

  const bindings: KeyBinding[] = [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '\u2191\u2193',
      action: 'navigate',
      handler: (_input, key) => {
        if (key.upArrow) {
          setFocused(stepEnabled(options, rows, focused, -1));
        }
        if (key.downArrow) {
          setFocused(stepEnabled(options, rows, focused, 1));
        }
      },
    },
    ...(viewport.needsScroll
      ? [
          {
            match: ['n', 'p'] as KeyMatchOrChar[],
            label: 'n/p',
            action: 'page',
            handler: (input: string) => {
              const target = viewport.pageStep(focused, input === 'n' ? 1 : -1);
              setFocused(
                options[target]?.disabled
                  ? stepEnabled(options, rows, target, 1)
                  : target,
              );
            },
          },
        ]
      : []),
    {
      match: KeyMatch.Return,
      label: 'enter',
      action: 'select',
      handler: () => {
        const selected = options[focused];
        if (selected && !selected.disabled) {
          onSelect(selected.value);
        }
      },
    },
  ];

  if (columns > 1) {
    bindings.splice(1, 0, {
      match: [KeyMatch.LeftArrow, KeyMatch.RightArrow],
      label: '\u2190\u2192',
      action: 'navigate',
      handler: (_input, key) => {
        const col = Math.floor(focused / rows);
        const row = focused % rows;

        let next = focused;
        if (key.leftArrow) {
          const prevCol = col > 0 ? col - 1 : columns - 1;
          next = Math.min(prevCol * rows + row, options.length - 1);
        }
        if (key.rightArrow) {
          const nextCol = col < columns - 1 ? col + 1 : 0;
          next = Math.min(nextCol * rows + row, options.length - 1);
        }
        // Landing on a disabled option slides to the column's nearest
        // enabled one.
        if (options[next]?.disabled) {
          next = stepEnabled(options, rows, next, 1);
        }
        setFocused(next);
      },
    });
  }

  useKeyBindings('single-picker', bindings);

  // Chunk options into columns (column-first ordering)
  const columnArrays: PickerOption<T>[][] = [];
  for (let c = 0; c < columns; c++) {
    columnArrays.push(options.slice(c * rows, c * rows + rows));
  }

  const align = centered ? 'center' : undefined;

  const renderOption = (opt: PickerOption<T>, flatIdx: number) => {
    const isFocused = flatIdx === focused;
    const base = opt.hint ? `${opt.label} (${opt.hint})` : opt.label;
    const label = opt.indent ? `  ${base}` : base;
    return (
      <Box key={flatIdx} gap={1} marginBottom={optionMarginBottom}>
        <Text
          color={isFocused ? Colors.accent : undefined}
          dimColor={!isFocused}
        >
          {isFocused && !opt.header ? Icons.triangleSmallRight : ' '}
        </Text>
        {opt.icon && <Text color={opt.icon.color}>{opt.icon.glyph}</Text>}
        <Text
          color={
            opt.header
              ? undefined
              : opt.disabled
              ? Colors.muted
              : isFocused
              ? Colors.accent
              : undefined
          }
          bold={opt.header || (isFocused && !opt.disabled)}
          dimColor={!opt.header && (!isFocused || opt.disabled)}
        >
          {label}
        </Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" alignItems={align}>
      <PromptLabel message={message} />
      {viewport.needsScroll ? (
        <Box flexDirection="column">
          <Text dimColor>
            {viewport.hiddenAbove > 0
              ? `↑ ${viewport.hiddenAbove} more (p)`
              : ' '}
          </Text>
          {options
            .slice(viewport.start, viewport.end)
            .map((opt, relIdx) => renderOption(opt, viewport.start + relIdx))}
          <Text dimColor>
            {viewport.hiddenBelow > 0
              ? `↓ ${viewport.hiddenBelow} more (n)`
              : ' '}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="row" gap={4}>
          {columnArrays.map((colOpts, colIdx) => (
            <Box key={colIdx} flexDirection="column">
              {colOpts.map((opt, rowIdx) =>
                renderOption(opt, colIdx * rows + rowIdx),
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

/**
 * Custom multi-select with checkbox glyphs and accent highlight.
 *
 * Interaction model (shared with GroupedPickerMenu):
 *   - \u2191\u2193 move the cursor through the options AND onto the Confirm button,
 *     which lives just past the last option.
 *   - enter toggles the focused option (no more "space toggles but enter
 *     advances" split that tripped people up). Space is kept as an
 *     undocumented alias, but the hints bar advertises only enter.
 *   - moving onto the Confirm button and pressing enter submits the
 *     current selection.
 */
const MultiPickerMenu = <T,>({
  message,
  options,
  centered = false,
  columns = 1,
  optionMarginBottom = 0,
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  optionMarginBottom?: number;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(() => firstEnabled(options));
  // When true, the cursor is on the Confirm button rather than an option.
  const [onButton, setOnButton] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const rows = Math.ceil(options.length / columns);
  // A row is its label line plus any margin; a description adds one line per
  // wrapped line beneath the label. Pages size to the tallest row.
  const rowCost = options.reduce(
    (max, opt) =>
      Math.max(
        max,
        1 +
          optionMarginBottom +
          (opt.description
            ? wordWrap(opt.description, DESCRIPTION_WIDTH).length
            : 0),
      ),
    1,
  );
  const viewport = usePickerViewport(
    options.length,
    rowCost,
    CONFIRM_CHROME,
    columns === 1,
    focused,
  );

  // Re-validate focus when the options change while mounted — a list
  // that shrinks or disables entries can leave `focused` pointing at a
  // missing or disabled option, which would make enter a no-op.
  useEffect(() => {
    if (focused >= options.length || options[focused]?.disabled) {
      setFocused(firstEnabled(options));
    }
  }, [options, focused]);

  const confirm = () => {
    const values = [...selected]
      .sort((a, b) => a - b)
      .map((i) => options[i].value);
    onSelect(values);
  };

  const bindings: KeyBinding[] = [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '\u2191\u2193',
      action: 'navigate',
      handler: (_input, key) => {
        if (key.upArrow) {
          if (onButton) {
            // Button \u2192 bottom of the grid (last enabled option).
            setOnButton(false);
            setFocused(lastEnabled(options));
            return;
          }
          const col = Math.floor(focused / rows);
          const row = focused % rows;
          // Nearest enabled option above in this column.
          let r = row - 1;
          while (r >= 0 && options[col * rows + r]?.disabled) r--;
          if (r >= 0) {
            setFocused(col * rows + r);
          } else {
            // Top of the column \u2192 wrap up onto the button.
            setOnButton(true);
          }
        }
        if (key.downArrow) {
          if (onButton) {
            // Button \u2192 top of the grid (first enabled option).
            setOnButton(false);
            setFocused(firstEnabled(options));
            return;
          }
          const col = Math.floor(focused / rows);
          const row = focused % rows;
          const colLen = Math.min(rows, options.length - col * rows);
          // Nearest enabled option below in this column.
          let r = row + 1;
          while (r < colLen && options[col * rows + r]?.disabled) r++;
          if (r < colLen) {
            setFocused(col * rows + r);
          } else {
            // Bottom of the column \u2192 down onto the button.
            setOnButton(true);
          }
        }
      },
    },
    ...(viewport.needsScroll
      ? [
          {
            match: ['n', 'p'] as KeyMatchOrChar[],
            label: 'n/p',
            action: 'page',
            handler: (input: string) => {
              const target = viewport.pageStep(focused, input === 'n' ? 1 : -1);
              setOnButton(false);
              setFocused(
                options[target]?.disabled
                  ? stepEnabled(options, rows, target, 1)
                  : target,
              );
            },
          },
        ]
      : []),
    {
      match: [KeyMatch.Space, KeyMatch.Return],
      label: 'enter',
      action: 'select',
      handler: () => {
        if (onButton) {
          confirm();
          return;
        }
        if (options[focused]?.disabled) return;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(focused)) {
            next.delete(focused);
            return next;
          }
          // Enforce mutual exclusivity: an exclusive option clears every other
          // pick; any other option clears previously-picked exclusive ones.
          if (options[focused]?.exclusive) {
            return new Set([focused]);
          }
          for (const i of next) {
            if (options[i]?.exclusive) {
              next.delete(i);
            }
          }
          next.add(focused);
          return next;
        });
      },
    },
    {
      match: 's',
      label: 's',
      action: 'submit',
      handler: confirm,
    },
  ];

  if (columns > 1) {
    bindings.splice(1, 0, {
      match: [KeyMatch.LeftArrow, KeyMatch.RightArrow],
      label: '\u2190\u2192',
      action: 'navigate',
      handler: (_input, key) => {
        if (onButton) return;
        const col = Math.floor(focused / rows);
        const row = focused % rows;

        let next = focused;
        if (key.leftArrow) {
          const prevCol = col > 0 ? col - 1 : columns - 1;
          next = Math.min(prevCol * rows + row, options.length - 1);
        }
        if (key.rightArrow) {
          const nextCol = col < columns - 1 ? col + 1 : 0;
          next = Math.min(nextCol * rows + row, options.length - 1);
        }
        // Landing on a disabled option slides to the column's nearest
        // enabled one.
        if (options[next]?.disabled) {
          next = stepEnabled(options, rows, next, 1);
        }
        setFocused(next);
      },
    });
  }

  useKeyBindings('multi-picker', bindings);

  const columnArrays: PickerOption<T>[][] = [];
  for (let c = 0; c < columns; c++) {
    columnArrays.push(options.slice(c * rows, c * rows + rows));
  }

  const renderOption = (opt: PickerOption<T>, flatIdx: number) => {
    const isFocused = !onButton && flatIdx === focused;
    const isSelected = selected.has(flatIdx);
    const label = opt.hint ? `${opt.label} (${opt.hint})` : opt.label;
    const checkbox = isSelected ? Icons.squareFilled : Icons.squareOpen;
    return (
      <Box
        key={flatIdx}
        flexDirection="column"
        marginBottom={optionMarginBottom}
      >
        <Box gap={1}>
          <Text
            color={isSelected ? 'white' : Colors.muted}
            dimColor={!isFocused && !isSelected}
          >
            {checkbox}
          </Text>
          {opt.icon && <Text color={opt.icon.color}>{opt.icon.glyph}</Text>}
          <Text
            color={
              opt.disabled
                ? Colors.muted
                : isFocused
                ? Colors.accent
                : undefined
            }
            bold={isFocused && !opt.disabled}
            dimColor={!isFocused || opt.disabled}
          >
            {label}
          </Text>
        </Box>
        {/* Optional dimmed, wrapped explanation under the label. The explicit
            width forces Ink to wrap (an unconstrained Box shrinks to its
            content and never wraps). Renders only when set, so label-only rows
            are byte-for-byte unchanged. */}
        {opt.description && (
          <Box marginLeft={4} width={DESCRIPTION_WIDTH}>
            <Text dimColor wrap="wrap">
              {opt.description}
            </Text>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" alignItems={centered ? 'center' : undefined}>
      <PromptLabel message={message} />
      {viewport.needsScroll ? (
        <Box
          flexDirection="column"
          marginLeft={centered ? 0 : 2}
          marginTop={message ? 1 : 0}
        >
          <Text dimColor>
            {viewport.hiddenAbove > 0
              ? `↑ ${viewport.hiddenAbove} more (p)`
              : ' '}
          </Text>
          {options
            .slice(viewport.start, viewport.end)
            .map((opt, relIdx) => renderOption(opt, viewport.start + relIdx))}
          <Text dimColor>
            {viewport.hiddenBelow > 0
              ? `↓ ${viewport.hiddenBelow} more (n)`
              : ' '}
          </Text>
        </Box>
      ) : (
        <Box
          flexDirection="row"
          gap={4}
          marginLeft={centered ? 0 : 2}
          marginTop={message ? 1 : 0}
        >
          {columnArrays.map((colOpts, colIdx) => (
            <Box key={colIdx} flexDirection="column">
              {colOpts.map((opt, rowIdx) =>
                renderOption(opt, colIdx * rows + rowIdx),
              )}
            </Box>
          ))}
        </Box>
      )}
      <Box marginTop={1} marginLeft={centered ? 0 : 2}>
        <ConfirmButton focused={onButton} count={selected.size} />
      </Box>
    </Box>
  );
};
