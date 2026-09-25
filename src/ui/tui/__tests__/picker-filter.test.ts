import {
  buildPickerIndex,
  rankOptions,
  type Searchable,
} from '@ui/tui/primitives/picker-filter';

const OPTIONS: Searchable[] = [
  { label: 'GitHub issues', hint: 'Issues opened on your repos' },
  { label: 'GitHub discussions', hint: 'Q&A threads' },
  { label: 'Error tracking', hint: 'Exceptions captured by PostHog' },
  { label: 'Session replay', hint: 'Recorded sessions' },
  { label: 'Linear issues', hint: 'Tickets from Linear' },
  { label: 'Stripe', hint: 'Payments and subscriptions' },
  { label: 'Zendesk tickets', hint: 'Support conversations' },
  { label: 'Snowflake', description: 'Warehouse source' },
];

function rank(query: string): string[] | null {
  const ranked = rankOptions(buildPickerIndex(OPTIONS), OPTIONS, query);
  return ranked?.map((option) => option.label) ?? null;
}

describe('rankOptions', () => {
  it('returns null for an empty or whitespace-only query, meaning "unfiltered"', () => {
    expect(rank('')).toBeNull();
    expect(rank('   ')).toBeNull();
  });

  it('ANDs terms, so a query spanning label words narrows to one option', () => {
    expect(rank('git iss')).toEqual(['GitHub issues']);
  });

  it('matches case-insensitively', () => {
    expect(rank('GITHUB')).toEqual(['GitHub issues', 'GitHub discussions']);
  });

  it('searches hint and description, not just the label', () => {
    expect(rank('exceptions')).toEqual(['Error tracking']);
    expect(rank('warehouse')).toEqual(['Snowflake']);
  });

  it('keeps the list order for literal matches rather than reordering by score', () => {
    expect(rank('issues')).toEqual(['GitHub issues', 'Linear issues']);
  });

  it('falls back to fuzzy matching when nothing matches literally', () => {
    // Dropped vowels: no substring match anywhere, so Fuse takes over and the
    // intended option has to come back first.
    expect(rank('gthb')?.[0]).toBe('GitHub discussions');
    expect(rank('zndsk')?.[0]).toBe('Zendesk tickets');
  });

  it('does not use the fuzzy pass when a literal match exists', () => {
    // "replay" fuzzy-matches half the list at this threshold; the literal pass
    // must win outright so the common case stays tight.
    expect(rank('replay')).toEqual(['Session replay']);
  });

  it('returns an empty list when even the fuzzy pass finds nothing', () => {
    expect(rank('qqqqqq')).toEqual([]);
  });
});
