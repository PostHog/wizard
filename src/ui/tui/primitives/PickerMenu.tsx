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
import { useEffect, useMemo, useState } from 'react';
import { buildPickerIndex, rankOptions } from './picker-filter.js';
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

export interface PickerOption<T> {
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

/** First enabled option in [start, end), for initial focus and for entering
 *  a page from the Confirm button. */
function firstEnabled<T>(
  options: PickerOption<T>[],
  start = 0,
  end = options.length,
): number {
  for (let i = start; i < end; i++) {
    if (!options[i]?.disabled) return i;
  }
  return start;
}

/** Last enabled option in [start, end), for wrapping from the button onto
 *  the bottom of the page. */
function lastEnabled<T>(
  options: PickerOption<T>[],
  start = 0,
  end = options.length,
): number {
  for (let i = end - 1; i >= start; i--) {
    if (!options[i]?.disabled) return i;
  }
  return end - 1;
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
/** Lists shorter than this never page — tall rows would split 2-3 options into pages of one. */
const MIN_COUNT_TO_PAGE = 5;
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
  const needsScroll =
    enabled && count >= MIN_COUNT_TO_PAGE && count * rowCost > budget;
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
  /**
   * Filter-as-you-type. Defaults on once the list is long enough to page, where
   * finding one option means walking pages. Pass `false` to force it off.
   */
  filterable?: boolean;
  onSelect: (value: T | T[]) => void;
}

/** Lists at least this long get filtering. Shorter ones fit on a page or two,
 *  where a filter row costs more rows than it saves. */
const FILTER_MIN_OPTIONS = 10;

export const PickerMenu = <T,>({
  message,
  options,
  mode = 'single',
  centered = false,
  columns = 1,
  optionMarginBottom = 0,
  filterable,
  onSelect,
}: PickerMenuProps<T>) => {
  const canFilter = filterable ?? options.length >= FILTER_MIN_OPTIONS;
  const [filter, setFilter] = useState('');
  const fuse = useMemo(
    () => (canFilter ? buildPickerIndex(options) : null),
    [options, canFilter],
  );
  const visible = useMemo(
    () => (fuse ? rankOptions(fuse, options, filter) ?? options : options),
    [fuse, options, filter],
  );

  // Keyed by label, and owned here rather than by MultiPickerMenu: filtering
  // rewrites the list under the ticks, and the remount below would drop them.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const shared = {
    message,
    options: visible,
    centered,
    optionMarginBottom,
    onSelect,
    filter: canFilter ? filter : null,
    setFilter,
    totalCount: options.length,
  };

  // A filtered list is a fresh list with its own focus and paging, so remount on
  // each query rather than leaving stale indices to be re-validated.
  const key = String(filter);

  if (mode === 'multi') {
    return (
      <MultiPickerMenu
        key={key}
        {...shared}
        columns={columns}
        allOptions={options}
        selected={selected}
        setSelected={setSelected}
      />
    );
  }

  return <SinglePickerMenu key={key} {...shared} columns={columns} />;
};

/**
 * Backspace and free typing. Append these last: `Printable` matches almost any
 * key, and bindings resolve in order, so anything specific has to be registered
 * first to keep working. Both share a label/action so the hints bar shows one.
 */
function filterBindings(
  filter: string,
  setFilter: (query: string) => void,
): KeyBinding[] {
  return [
    {
      match: KeyMatch.Backspace,
      label: 'type',
      action: 'filter',
      handler: () => setFilter(filter.slice(0, -1)),
    },
    {
      match: KeyMatch.Printable,
      label: 'type',
      action: 'filter',
      handler: (input: string) => setFilter(filter + input),
    },
  ];
}

/** The filter row above a filterable list: what's typed, and how much it left. */
const FilterRow = ({
  filter,
  shown,
  total,
}: {
  filter: string;
  shown: number;
  total: number;
}) => (
  // Indented to sit under PromptLabel, which carries a leading space.
  <Box paddingLeft={1} marginY={1}>
    <Text dimColor>
      {filter
        ? `Filter: ${filter} (${shown} of ${total})`
        : `Type to filter ${total} options`}
    </Text>
  </Box>
);

/** Custom single-select with triangle indicator and accent highlight. */
const SinglePickerMenu = <T,>({
  message,
  options,
  centered = false,
  columns = 1,
  optionMarginBottom = 0,
  filter,
  setFilter,
  totalCount,
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  optionMarginBottom?: number;
  /** Current filter query, or null when this picker isn't filterable. */
  filter: string | null;
  setFilter: (query: string) => void;
  totalCount: number;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(() => firstEnabled(options));
  const rows = Math.ceil(options.length / columns);
  // Single-select rows are label-only (no descriptions): one line plus margin.
  const viewport = usePickerViewport(
    options.length,
    1 + optionMarginBottom,
    filter !== null ? 1 : 0,
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
        const dir = key.upArrow ? -1 : 1;
        // `start`/`end` derive from `focused`, so stepping past a page edge
        // flips the page rather than needing a bound here.
        setFocused(stepEnabled(options, rows, focused, dir));
      },
    },
    // Only on a non-filterable list. Once a filter row exists `n` and `p` are
    // characters, not commands — so they go for good, not just once a query is
    // typed, and the arrows carry paging instead by walking the whole list.
    ...(viewport.needsScroll && filter === null
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

  if (filter !== null) {
    bindings.push(...filterBindings(filter, setFilter));
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
      {filter !== null && (
        <FilterRow filter={filter} shown={options.length} total={totalCount} />
      )}
      {filter && options.length === 0 ? (
        <Text dimColor>No options match. Backspace to widen the filter.</Text>
      ) : viewport.needsScroll ? (
        <Box flexDirection="column">
          <Text dimColor>
            {viewport.hiddenAbove > 0
              ? `↑ ${viewport.hiddenAbove} more${
                  filter === null ? ' [P] for previous page' : ''
                }`
              : ' '}
          </Text>
          {options
            .slice(viewport.start, viewport.end)
            .map((opt, relIdx) => renderOption(opt, viewport.start + relIdx))}
          <Text dimColor>
            {viewport.hiddenBelow > 0
              ? `↓ ${viewport.hiddenBelow} more${
                  filter === null ? ' [N] for next page' : ''
                }`
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
  filter,
  setFilter,
  totalCount,
  allOptions,
  selected,
  setSelected,
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  optionMarginBottom?: number;
  /** Current filter query, or null when this picker isn't filterable. */
  filter: string | null;
  setFilter: (query: string) => void;
  totalCount: number;
  /** Every option, filtered or not. Ticks outlive the query, so resolving and
   *  submitting them has to happen against the full list. */
  allOptions: PickerOption<T>[];
  selected: Set<string>;
  setSelected: (update: (prev: Set<string>) => Set<string>) => void;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(() => firstEnabled(options));
  // When true, the cursor is on the Confirm button rather than an option.
  const [onButton, setOnButton] = useState(false);
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
    CONFIRM_CHROME + (filter !== null ? 1 : 0),
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
    // In `allOptions` order, so a pick made under one filter still submits
    // after the query moved on.
    const values = allOptions
      .filter((option) => selected.has(option.label))
      .map((option) => option.value);
    onSelect(values);
  };

  const bindings: KeyBinding[] = [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '\u2191\u2193',
      action: 'navigate',
      handler: (_input, key) => {
        const dir = key.upArrow ? -1 : 1;
        if (onButton) {
          // Button \u2192 back onto the current page (bottom for \u2191, top for \u2193).
          setOnButton(false);
          setFocused(
            dir === -1
              ? lastEnabled(options, viewport.start, viewport.end)
              : firstEnabled(options, viewport.start, viewport.end),
          );
          return;
        }
        const col = Math.floor(focused / rows);
        const row = focused % rows;
        const colLen = Math.min(rows, options.length - col * rows);
        // Nearest enabled option above/below in this column; leaving the
        // column lands on the button.
        let r = row + dir;
        while (r >= 0 && r < colLen && options[col * rows + r]?.disabled) {
          r += dir;
        }
        if (r >= 0 && r < colLen) {
          setFocused(col * rows + r);
        } else {
          setOnButton(true);
        }
      },
    },
    // Only on a non-filterable list. Once a filter row exists `n` and `p` are
    // characters, not commands — so they go for good, not just once a query is
    // typed, and the arrows carry paging instead by walking the whole list.
    ...(viewport.needsScroll && filter === null
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
      // Space is only an alias for enter when there's no filter to type into.
      match:
        filter !== null ? KeyMatch.Return : [KeyMatch.Space, KeyMatch.Return],
      label: 'enter',
      action: 'select',
      handler: () => {
        if (onButton) {
          confirm();
          return;
        }
        // `focused` can point past the end: filtering to zero matches leaves
        // nothing under the cursor, and enter is the natural thing to try there.
        const option = options[focused];
        if (!option || option.disabled) return;
        const label = option.label;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(label)) {
            next.delete(label);
            return next;
          }
          // Enforce mutual exclusivity: an exclusive option clears every other
          // pick; any other option clears previously-picked exclusive ones.
          if (option.exclusive) {
            return new Set([label]);
          }
          // Against `allOptions`: the pick being cleared may be off-screen
          // under the current query.
          for (const picked of next) {
            if (allOptions.find((o) => o.label === picked)?.exclusive) {
              next.delete(picked);
            }
          }
          next.add(label);
          return next;
        });
      },
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

  if (filter !== null) {
    bindings.push(...filterBindings(filter, setFilter));
  }

  useKeyBindings('multi-picker', bindings);

  const columnArrays: PickerOption<T>[][] = [];
  for (let c = 0; c < columns; c++) {
    columnArrays.push(options.slice(c * rows, c * rows + rows));
  }

  const renderOption = (opt: PickerOption<T>, flatIdx: number) => {
    const isFocused = !onButton && flatIdx === focused;
    const isSelected = selected.has(opt.label);
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
      {filter !== null && (
        <FilterRow filter={filter} shown={options.length} total={totalCount} />
      )}
      {filter && options.length === 0 && (
        <Text dimColor>No options match. Backspace to widen the filter.</Text>
      )}
      {viewport.needsScroll ? (
        <Box
          flexDirection="column"
          marginLeft={centered ? 0 : 2}
          marginTop={message ? 1 : 0}
        >
          <Text dimColor>
            {viewport.hiddenAbove > 0
              ? `↑ ${viewport.hiddenAbove} more${
                  filter === null ? ' [P] for previous page' : ''
                }`
              : ' '}
          </Text>
          {options
            .slice(viewport.start, viewport.end)
            .map((opt, relIdx) => renderOption(opt, viewport.start + relIdx))}
          <Text dimColor>
            {viewport.hiddenBelow > 0
              ? `↓ ${viewport.hiddenBelow} more${
                  filter === null ? ' [N] for next page' : ''
                }`
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
