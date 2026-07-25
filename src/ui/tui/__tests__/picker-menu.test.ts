import { pruneSelected, selectedValues } from '@ui/tui/primitives/PickerMenu';

type Opt = { label: string; value: string; disabled?: boolean };

const opts = (...labels: string[]): Opt[] =>
  labels.map((l) => ({ label: l, value: l }));

describe('selectedValues', () => {
  it('resolves selected indices to values in option order', () => {
    const options = opts('a', 'b', 'c');
    expect(selectedValues(options, new Set([2, 0]))).toEqual(['a', 'c']);
  });

  it('drops indices that no longer resolve to an option instead of crashing', () => {
    // The multi-select set was built against a 3-item list, then the list
    // shrank to 1 before confirm() ran — index 2 now points at nothing.
    const options = opts('a');
    expect(() => selectedValues(options, new Set([0, 2]))).not.toThrow();
    expect(selectedValues(options, new Set([0, 2]))).toEqual(['a']);
  });

  it('returns an empty array when nothing resolves', () => {
    expect(selectedValues(opts(), new Set([0, 1]))).toEqual([]);
  });
});

describe('pruneSelected', () => {
  it('removes indices past the end of the list', () => {
    const options = opts('a', 'b');
    expect([...pruneSelected(options, new Set([0, 1, 5]))]).toEqual([0, 1]);
  });

  it('removes indices that now point at a disabled option', () => {
    const options: Opt[] = [
      { label: 'a', value: 'a' },
      { label: 'b', value: 'b', disabled: true },
    ];
    expect([...pruneSelected(options, new Set([0, 1]))]).toEqual([0]);
  });

  it('returns the same Set reference when nothing was pruned', () => {
    const options = opts('a', 'b', 'c');
    const selected = new Set([0, 2]);
    // Referential stability lets the caller skip a needless setState/re-render.
    expect(pruneSelected(options, selected)).toBe(selected);
  });
});
