import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import {
  getPackageVersion,
  getInstalledPackageVersion,
  hasPackageInstalled,
  findInstalledPackageFromList,
  type PackageDotJson,
} from '../utils/package-json';

describe('getPackageVersion', () => {
  it('returns version from dependencies', () => {
    const pkg: PackageDotJson = { dependencies: { next: '^15.1.0' } };
    expect(getPackageVersion('next', pkg)).toBe('^15.1.0');
  });

  it('returns version from devDependencies', () => {
    const pkg: PackageDotJson = { devDependencies: { jest: '~29.5.0' } };
    expect(getPackageVersion('jest', pkg)).toBe('~29.5.0');
  });

  it('prefers dependencies over devDependencies', () => {
    const pkg: PackageDotJson = {
      dependencies: { next: '15.5.9' },
      devDependencies: { next: '^15.0.0' },
    };
    expect(getPackageVersion('next', pkg)).toBe('15.5.9');
  });

  it('returns undefined for missing package', () => {
    const pkg: PackageDotJson = { dependencies: { react: '19.0.0' } };
    expect(getPackageVersion('next', pkg)).toBeUndefined();
  });

  it('returns undefined for empty package.json', () => {
    const pkg: PackageDotJson = {};
    expect(getPackageVersion('next', pkg)).toBeUndefined();
  });
});

describe('getInstalledPackageVersion', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wizard-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function installFakePackage(name: string, version: string) {
    const pkgDir = path.join(tmpDir, 'node_modules', name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name, version }),
    );
  }

  it('reads the actual installed version, not the range', () => {
    // This is the bug that caused Andy's issue: package.json says "^15.1.0"
    // but the installed version in node_modules is 15.5.9
    installFakePackage('next', '15.5.9');
    expect(getInstalledPackageVersion('next', tmpDir)).toBe('15.5.9');
  });

  it('reads exact pinned versions', () => {
    installFakePackage('next', '15.3.0');
    expect(getInstalledPackageVersion('next', tmpDir)).toBe('15.3.0');
  });

  it('reads prerelease versions', () => {
    installFakePackage('next', '16.0.0-canary.42');
    expect(getInstalledPackageVersion('next', tmpDir)).toBe('16.0.0-canary.42');
  });

  it('reads scoped package versions', () => {
    installFakePackage('@angular/core', '19.2.0');
    expect(getInstalledPackageVersion('@angular/core', tmpDir)).toBe('19.2.0');
  });

  it('returns undefined when package is not installed', () => {
    expect(getInstalledPackageVersion('next', tmpDir)).toBeUndefined();
  });

  it('returns undefined when node_modules does not exist', () => {
    const noModulesDir = path.join(tmpDir, 'empty-project');
    mkdirSync(noModulesDir);
    expect(getInstalledPackageVersion('next', noModulesDir)).toBeUndefined();
  });

  it('returns undefined for malformed package.json in node_modules', () => {
    const pkgDir = path.join(tmpDir, 'node_modules', 'broken');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(path.join(pkgDir, 'package.json'), 'not json');
    expect(getInstalledPackageVersion('broken', tmpDir)).toBeUndefined();
  });
});

describe('getInstalledPackageVersion vs getPackageVersion', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wizard-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function installFakePackage(name: string, version: string) {
    const pkgDir = path.join(tmpDir, 'node_modules', name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name, version }),
    );
  }

  const rangeSpecifiers = [
    // Caret and tilde — most common in real projects
    { range: '^15.1.0', installed: '15.5.9', label: 'caret (^)' },
    { range: '~15.1.0', installed: '15.1.7', label: 'tilde (~)' },

    // Comparison operators
    { range: '>=15.0.0', installed: '15.5.9', label: 'gte (>=)' },
    { range: '>15.0.0', installed: '15.5.9', label: 'gt (>)' },
    { range: '<=16.0.0', installed: '15.5.9', label: 'lte (<=)' },
    { range: '<16.0.0', installed: '15.5.9', label: 'lt (<)' },

    // Compound range
    {
      range: '>=15.0.0 <16.0.0',
      installed: '15.5.9',
      label: 'compound (>=a <b)',
    },

    // Hyphen range
    {
      range: '15.0.0 - 16.0.0',
      installed: '15.5.9',
      label: 'hyphen (a - b)',
    },

    // OR / union
    {
      range: '^14.0.0 || ^15.0.0',
      installed: '15.5.9',
      label: 'OR (||)',
    },

    // Wildcards and x-ranges
    { range: '*', installed: '15.5.9', label: 'wildcard (*)' },
    { range: '15.x', installed: '15.5.9', label: 'x-range (15.x)' },
    { range: '15.1.x', installed: '15.1.7', label: 'x-range patch (15.1.x)' },
    {
      range: '15.*.*',
      installed: '15.5.9',
      label: 'wildcard minor+patch (15.*.*)',
    },

    // Exact / pinned
    { range: '15.5.9', installed: '15.5.9', label: 'pinned exact' },

    // pnpm workspace protocol
    { range: 'workspace:^', installed: '15.5.9', label: 'workspace:^' },
    { range: 'workspace:*', installed: '15.5.9', label: 'workspace:*' },
    { range: 'workspace:~', installed: '15.5.9', label: 'workspace:~' },

    // Dist-tags (npm resolves these, node_modules always has real version)
    { range: 'latest', installed: '15.5.9', label: 'dist-tag (latest)' },
    { range: 'next', installed: '16.0.0-canary.42', label: 'dist-tag (next)' },
  ];

  it.each(rangeSpecifiers)(
    'getPackageVersion returns the range for $label, getInstalledPackageVersion returns the real version',
    ({ range, installed }) => {
      const pkg: PackageDotJson = { dependencies: { next: range } };
      installFakePackage('next', installed);

      // getPackageVersion returns the raw range from package.json
      expect(getPackageVersion('next', pkg)).toBe(range);

      // getInstalledPackageVersion returns the actual resolved version
      expect(getInstalledPackageVersion('next', tmpDir)).toBe(installed);
    },
  );
});

describe('hasPackageInstalled', () => {
  it('returns true when package exists in dependencies', () => {
    const pkg: PackageDotJson = { dependencies: { next: '^15.1.0' } };
    expect(hasPackageInstalled('next', pkg)).toBe(true);
  });

  it('returns false when package is missing', () => {
    const pkg: PackageDotJson = { dependencies: { react: '19.0.0' } };
    expect(hasPackageInstalled('next', pkg)).toBe(false);
  });
});

describe('findInstalledPackageFromList', () => {
  it('returns first matching package with its version', () => {
    const pkg: PackageDotJson = {
      dependencies: { react: '19.0.0', next: '^15.1.0' },
    };
    const result = findInstalledPackageFromList(['vue', 'next', 'react'], pkg);
    expect(result).toEqual({ name: 'next', version: '^15.1.0' });
  });

  it('returns undefined when none match', () => {
    const pkg: PackageDotJson = { dependencies: { react: '19.0.0' } };
    const result = findInstalledPackageFromList(['vue', 'next'], pkg);
    expect(result).toBeUndefined();
  });
});
