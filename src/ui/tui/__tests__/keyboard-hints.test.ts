import {
  matchesKey,
  getDefaultPriority,
  hintsKey,
  deduplicateAndSort,
  KeyMatch,
  type KeyboardHint,
} from '@ui/tui/hooks/keyboard-hints-utils';

/** Helper to create a key flags object with all booleans false by default. */
function makeKey(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    ...overrides,
  };
}

describe('matchesKey', () => {
  it('matches upArrow', () => {
    expect(matchesKey(KeyMatch.UpArrow, '', makeKey({ upArrow: true }))).toBe(
      true,
    );
    expect(matchesKey(KeyMatch.UpArrow, '', makeKey({ downArrow: true }))).toBe(
      false,
    );
  });

  it('matches downArrow', () => {
    expect(
      matchesKey(KeyMatch.DownArrow, '', makeKey({ downArrow: true })),
    ).toBe(true);
    expect(matchesKey(KeyMatch.DownArrow, '', makeKey())).toBe(false);
  });

  it('matches leftArrow', () => {
    expect(
      matchesKey(KeyMatch.LeftArrow, '', makeKey({ leftArrow: true })),
    ).toBe(true);
  });

  it('matches rightArrow', () => {
    expect(
      matchesKey(KeyMatch.RightArrow, '', makeKey({ rightArrow: true })),
    ).toBe(true);
  });

  it('matches return', () => {
    expect(matchesKey(KeyMatch.Return, '', makeKey({ return: true }))).toBe(
      true,
    );
    expect(matchesKey(KeyMatch.Return, '', makeKey())).toBe(false);
  });

  it('matches escape', () => {
    expect(matchesKey(KeyMatch.Escape, '', makeKey({ escape: true }))).toBe(
      true,
    );
  });

  it('matches space via input string', () => {
    expect(matchesKey(KeyMatch.Space, ' ', makeKey())).toBe(true);
    expect(matchesKey(KeyMatch.Space, 'x', makeKey())).toBe(false);
  });

  it('matches character keys via input string', () => {
    expect(matchesKey('a', 'a', makeKey())).toBe(true);
    expect(matchesKey('a', 'b', makeKey())).toBe(false);
    expect(matchesKey('s', 's', makeKey())).toBe(true);
  });

  it('does not match unrelated keys', () => {
    expect(matchesKey(KeyMatch.Return, '', makeKey({ escape: true }))).toBe(
      false,
    );
    expect(matchesKey(KeyMatch.UpArrow, '', makeKey({ leftArrow: true }))).toBe(
      false,
    );
  });
});

describe('getDefaultPriority', () => {
  it('returns 0 for vertical navigation keys', () => {
    expect(getDefaultPriority(KeyMatch.UpArrow)).toBe(0);
    expect(getDefaultPriority(KeyMatch.DownArrow)).toBe(0);
    expect(getDefaultPriority([KeyMatch.UpArrow, KeyMatch.DownArrow])).toBe(0);
  });

  it('returns 1 for horizontal navigation keys', () => {
    expect(getDefaultPriority(KeyMatch.LeftArrow)).toBe(1);
    expect(getDefaultPriority([KeyMatch.LeftArrow, KeyMatch.RightArrow])).toBe(
      1,
    );
  });

  it('returns 10 for space', () => {
    expect(getDefaultPriority(KeyMatch.Space)).toBe(10);
  });

  it('returns 20 for escape', () => {
    expect(getDefaultPriority(KeyMatch.Escape)).toBe(20);
  });

  it('returns 21 for return', () => {
    expect(getDefaultPriority(KeyMatch.Return)).toBe(21);
  });

  it('returns 15 for unknown character keys', () => {
    expect(getDefaultPriority('a')).toBe(15);
    expect(getDefaultPriority('s')).toBe(15);
    expect(getDefaultPriority('x')).toBe(15);
  });

  it('uses first element priority for arrays', () => {
    expect(getDefaultPriority([KeyMatch.Return, KeyMatch.Escape])).toBe(21);
    expect(getDefaultPriority([KeyMatch.Space, KeyMatch.Return])).toBe(10);
  });
});

describe('hintsKey', () => {
  it('serializes hints into a pipe-separated string', () => {
    const hints: KeyboardHint[] = [
      { label: '↑↓', action: 'navigate', priority: 0 },
      { label: 'enter', action: 'confirm', priority: 21 },
    ];
    expect(hintsKey(hints)).toBe('↑↓:navigate|enter:confirm');
  });

  it('returns empty string for empty array', () => {
    expect(hintsKey([])).toBe('');
  });
});

describe('deduplicateAndSort', () => {
  it('removes duplicate hints by label+action', () => {
    const hints: KeyboardHint[] = [
      { label: '↑↓', action: 'navigate', priority: 0 },
      { label: '↑↓', action: 'navigate', priority: 0 },
      { label: 'enter', action: 'confirm', priority: 21 },
    ];
    const result = deduplicateAndSort(hints);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe('↑↓');
    expect(result[1].label).toBe('enter');
  });

  it('sorts by priority ascending', () => {
    const hints: KeyboardHint[] = [
      { label: 'enter', action: 'confirm', priority: 21 },
      { label: 'space', action: 'toggle', priority: 10 },
      { label: '↑↓', action: 'navigate', priority: 0 },
      { label: 'esc', action: 'cancel', priority: 20 },
    ];
    const result = deduplicateAndSort(hints);
    expect(result.map((h: KeyboardHint) => h.label)).toEqual([
      '↑↓',
      'space',
      'esc',
      'enter',
    ]);
  });

  it('handles empty array', () => {
    expect(deduplicateAndSort([])).toEqual([]);
  });

  it('keeps first occurrence when duplicates have different priorities', () => {
    const hints: KeyboardHint[] = [
      { label: '↑↓', action: 'navigate', priority: 5 },
      { label: '↑↓', action: 'navigate', priority: 0 },
    ];
    const result = deduplicateAndSort(hints);
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe(5);
  });

  it('preserves hints with same label but different action', () => {
    const hints: KeyboardHint[] = [
      { label: 'enter', action: 'confirm', priority: 21 },
      { label: 'enter', action: 'select', priority: 21 },
    ];
    const result = deduplicateAndSort(hints);
    expect(result).toHaveLength(2);
  });

  it('produces correct ordering for a typical multi-select screen', () => {
    const hints: KeyboardHint[] = [
      { label: '↑↓', action: 'navigate', priority: 0 },
      { label: 'space', action: 'toggle', priority: 10 },
      { label: 'a', action: 'toggle all', priority: 11 },
      { label: 'enter', action: 'confirm', priority: 21 },
    ];
    const result = deduplicateAndSort(hints);
    expect(result.map((h: KeyboardHint) => h.label)).toEqual([
      '↑↓',
      'space',
      'a',
      'enter',
    ]);
  });

  it('produces correct ordering for a confirmation screen', () => {
    const hints: KeyboardHint[] = [
      { label: '←→', action: 'switch', priority: 1 },
      { label: 'enter', action: 'confirm', priority: 21 },
      { label: 'esc', action: 'cancel', priority: 20 },
    ];
    const result = deduplicateAndSort(hints);
    expect(result.map((h: KeyboardHint) => h.label)).toEqual([
      '←→',
      'esc',
      'enter',
    ]);
  });
});
