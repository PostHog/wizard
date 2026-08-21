import { normalizeAbortReason } from '@lib/agent/abort-reason';

describe('normalizeAbortReason', () => {
  it('leaves a clean reason untouched', () => {
    expect(normalizeAbortReason('no mcp server found')).toBe(
      'no mcp server found',
    );
  });

  // Every string below was observed on a real `wizard: agent aborted` event —
  // the model wrapped the reason in markdown and the capture regex, which reads
  // to end-of-line, took the punctuation with it.
  it.each([
    ['no mcp server found`', 'no mcp server found'],
    ['no mcp server found**', 'no mcp server found'],
    ['**no mcp server found**', 'no mcp server found'],
    ['`no mcp server found`', 'no mcp server found'],
    ['no mcp server found.', 'no mcp server found'],
    ['"no mcp server found"', 'no mcp server found'],
    ['  no mcp server found  ', 'no mcp server found'],
  ])('strips wrapper noise from %j', (raw, expected) => {
    expect(normalizeAbortReason(raw)).toBe(expected);
  });

  it('collapses internal whitespace', () => {
    expect(normalizeAbortReason('no  mcp\tserver found')).toBe(
      'no mcp server found',
    );
  });

  it('keeps noise inside the phrase, leaving it to prefix-anchored matching', () => {
    // Normalization is deliberately conservative — it does not guess where the
    // intended phrase ended, so a trailing clause survives.
    expect(normalizeAbortReason('no mcp server found` case.')).toBe(
      'no mcp server found` case',
    );
  });

  it('reduces an all-noise reason to the empty string', () => {
    expect(normalizeAbortReason('**')).toBe('');
  });
});
