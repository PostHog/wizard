import { relative } from 'path';
import type { ProgramSession } from '@programs/program-contract';
import { safeReadFile, walkProjectFiles } from '@utils/bounded-fs';

export type SidecarVendor = 'amplitude' | 'mixpanel' | 'segment' | 'heap';

/** Browser SDK packages per vendor. Heap web is snippet-only, so the agent finds it in source. */
export const SIDECAR_VENDOR_PACKAGES: Record<SidecarVendor, readonly string[]> =
  {
    amplitude: [
      '@amplitude/analytics-browser',
      '@amplitude/unified',
      'amplitude-js',
    ],
    mixpanel: ['mixpanel-browser'],
    segment: ['@segment/analytics-next'],
    heap: [],
  };

export const SIDECAR_VENDORS_KEY = 'sidecarVendors';

export interface SidecarVendorMatch {
  vendor: SidecarVendor;
  packageName: string;
  /** package.json path relative to installDir */
  path: string;
}

/** Scan the project's package.json files (bounded depth) for supported vendor browser SDKs. */
export function findSidecarVendors(installDir: string): SidecarVendorMatch[] {
  const matches: SidecarVendorMatch[] = [];
  walkProjectFiles(installDir, (name, fullPath) => {
    if (name !== 'package.json') return;
    const content = safeReadFile(fullPath);
    if (content === null) return;
    try {
      const pkg = JSON.parse(content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]);
      for (const [vendor, packages] of Object.entries(
        SIDECAR_VENDOR_PACKAGES,
      )) {
        const packageName = packages.find((p) => deps.has(p));
        if (packageName) {
          matches.push({
            vendor: vendor as SidecarVendor,
            packageName,
            path: relative(installDir, fullPath) || 'package.json',
          });
        }
      }
    } catch {
      // Skip malformed package.json
    }
  });
  return matches;
}

export function detectSidecarVendors(
  session: ProgramSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): void {
  setFrameworkContext(
    SIDECAR_VENDORS_KEY,
    findSidecarVendors(session.installDir),
  );
}

/** One prompt line naming what detection found, so the agent starts from it. */
export function describeSidecarVendors(
  matches: readonly SidecarVendorMatch[],
): string {
  if (matches.length === 0) {
    return 'The wizard found no Amplitude, Mixpanel or Segment package in package.json. Heap is snippet-only, so search the source for it.';
  }
  const found = matches
    .map((m) => `${m.vendor} (${m.packageName} in ${m.path})`)
    .join(', ');
  return `The wizard found these vendor packages: ${found}. Also check the source for a Heap snippet.`;
}
