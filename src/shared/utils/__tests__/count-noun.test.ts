import { countNoun } from '@utils/count-noun';

describe('countNoun', () => {
  it('uses the singular for exactly one', () => {
    expect(countNoun(1, 'error')).toBe('1 error');
  });

  it('uses the plural for zero and for more than one', () => {
    expect(countNoun(0, 'error')).toBe('0 errors');
    expect(countNoun(2, 'error')).toBe('2 errors');
  });

  it('takes a custom plural', () => {
    expect(countNoun(1, 'pass', 'passes')).toBe('1 pass');
    expect(countNoun(2, 'pass', 'passes')).toBe('2 passes');
  });
});
