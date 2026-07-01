import { isIgnoredForDismiss } from '@ui/tui/hooks/useDismissOnAnyKey';

describe('isIgnoredForDismiss', () => {
  it('ignores a ctrl-combo keypress', () => {
    expect(isIgnoredForDismiss({ ctrl: true, meta: false })).toBe(true);
  });

  it('ignores a meta-combo keypress', () => {
    expect(isIgnoredForDismiss({ ctrl: false, meta: true })).toBe(true);
  });

  it('ignores a keypress with both modifiers held', () => {
    expect(isIgnoredForDismiss({ ctrl: true, meta: true })).toBe(true);
  });

  it('does not ignore a plain keypress', () => {
    expect(isIgnoredForDismiss({ ctrl: false, meta: false })).toBe(false);
  });
});
