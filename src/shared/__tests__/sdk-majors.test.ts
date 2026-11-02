import { Integration } from '@shared/constants';
import {
  SDK_IDS,
  SDK_MAJORS,
  getSdkMajorRow,
  isSdkId,
  majorForMode,
  modeForInstalledMajor,
  sdkRowsForIntegration,
} from '@shared/sdk-majors';

describe('SDK_MAJORS', () => {
  it('has one row per SDK id', () => {
    expect(new Set(SDK_IDS).size).toBe(SDK_MAJORS.length);
  });

  it.each(SDK_MAJORS.map((row) => [row.sdk, row] as const))(
    '%s: the first v1 major follows the last legacy major and both modes name a package',
    (_sdk, row) => {
      expect(row.firstV1Major).toBe(row.legacyMajor + 1);
      expect(row.packages.legacy.length).toBeGreaterThan(0);
      expect(row.packages.v1.length).toBeGreaterThan(0);
      expect(row.primaryIntegrations.length).toBeGreaterThan(0);
    },
  );

  it('maps each integration to at most one primary SDK', () => {
    const seen = new Map<Integration, string>();
    for (const row of SDK_MAJORS) {
      for (const integration of row.primaryIntegrations) {
        expect(seen.get(integration)).toBeUndefined();
        seen.set(integration, row.sdk);
      }
    }
  });

  it('never lists an integration as both primary and secondary for one SDK', () => {
    for (const row of SDK_MAJORS) {
      for (const integration of Object.keys(row.secondary)) {
        expect(row.primaryIntegrations).not.toContain(integration);
      }
    }
  });

  it('only changes the package name across the major for Go', () => {
    for (const row of SDK_MAJORS) {
      if (row.sdk === 'posthog-go') {
        expect(row.packages.legacy).toEqual(['github.com/posthog/posthog-go']);
        expect(row.packages.v1).toEqual(['github.com/posthog/posthog-go/v2']);
      } else {
        expect(row.packages.v1).toEqual(row.packages.legacy);
      }
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SDK_MAJORS)).toBe(true);
  });
});

describe('sdkRowsForIntegration', () => {
  it('returns the primary row for a server-side integration', () => {
    const { primary, secondary } = sdkRowsForIntegration(Integration.django);
    expect(primary?.sdk).toBe('posthog-python');
    expect(secondary).toEqual([]);
  });

  it('returns posthog-node as secondary for a server-rendered web framework', () => {
    const { primary, secondary } = sdkRowsForIntegration(Integration.nextjs);
    expect(primary).toBeUndefined();
    expect(secondary.map((row) => row.sdk)).toEqual(['posthog-node']);
  });

  it('returns nothing for an integration outside the allowlist', () => {
    const { primary, secondary } = sdkRowsForIntegration(Integration.rails);
    expect(primary).toBeUndefined();
    expect(secondary).toEqual([]);
  });
});

describe('row helpers', () => {
  const python = getSdkMajorRow('posthog-python');

  it('majorForMode picks the legacy or first v1 major', () => {
    expect(majorForMode(python, 'legacy')).toBe(7);
    expect(majorForMode(python, 'v1')).toBe(8);
  });

  it('modeForInstalledMajor treats every major from the first v1 major on as v1', () => {
    expect(modeForInstalledMajor(python, 3)).toBe('legacy');
    expect(modeForInstalledMajor(python, 7)).toBe('legacy');
    expect(modeForInstalledMajor(python, 8)).toBe('v1');
    expect(modeForInstalledMajor(python, 9)).toBe('v1');
  });

  it('isSdkId accepts the table ids only', () => {
    expect(isSdkId('posthog-rs')).toBe(true);
    expect(isSdkId('posthog-js')).toBe(false);
    expect(isSdkId(42)).toBe(false);
  });

  it('getSdkMajorRow throws for an id outside the table', () => {
    expect(() => getSdkMajorRow('posthog-js' as never)).toThrow(
      'No SDK major row',
    );
  });
});
