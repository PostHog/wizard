import {
  isUnboundedRequirement,
  lowerBoundMajor,
  majorOfVersion,
} from '@services/detection/sdk-install/version-spec';

describe('lowerBoundMajor', () => {
  it.each([
    // npm
    ['^5.60.0', 5],
    ['~5.60.0', 5],
    ['>=5.0.0 <6.0.0', 5],
    ['5.x', 5],
    ['6', 6],
    ['^5 || ^6', 5],
    // PEP 440 and poetry
    ['>=7,<8', 7],
    ['>=7, <8', 7],
    ['==7.*', 7],
    ['~=7.1', 7],
    ['^3.0', 3],
    ['>7', 7],
    // cargo
    ['0.30', 0],
    ['1', 1],
    ['>=1, <2', 1],
    // pub
    ['^5.58.4', 5],
    ["'>=5.0.0 <6.0.0'", 5],
    // gradle and maven
    ['3.75.0', 3],
    ['3.+', 3],
    ['[3.0,4.0)', 3],
    // swift
    ['from: 3.0.0', 3],
    ['v2.0.0', 2],
  ])('%s admits major %i', (spec, major) => {
    expect(lowerBoundMajor(spec)).toBe(major);
  });

  it.each([
    ['*'],
    ['any'],
    ['latest'],
    [''],
    ['<8'],
    ['!=7.1'],
    ['x'],
    ['(,4.0]'],
  ])('%s has no lower bound', (spec) => {
    expect(lowerBoundMajor(spec)).toBeUndefined();
  });
});

describe('majorOfVersion', () => {
  it('reads the major of a concrete version', () => {
    expect(majorOfVersion('7.82.1')).toBe(7);
    expect(majorOfVersion('v2.0.0')).toBe(2);
    expect(majorOfVersion('"0.30.0"')).toBe(0);
  });

  it('rejects a requirement or a bare word', () => {
    expect(majorOfVersion('^7.82.1')).toBeUndefined();
    expect(majorOfVersion('latest')).toBeUndefined();
  });
});

describe('isUnboundedRequirement', () => {
  it.each([['>=3.0.0'], ['>=7'], ['>7, >=7.1'], ['[3.0,)'], ['">=0.30"']])(
    '%s is unbounded',
    (spec) => {
      expect(isUnboundedRequirement(spec)).toBe(true);
    },
  );

  it.each([
    ['^5'],
    ['~5.60.0'],
    ['>=7,<8'],
    ['==7.*'],
    ['~=7.1'],
    ['5.61.2'],
    ['0.30'],
    ['3.+'],
    ['[3.0,4.0)'],
    ['*'],
    [''],
  ])('%s is bounded or has no requirement', (spec) => {
    expect(isUnboundedRequirement(spec)).toBe(false);
  });
});
