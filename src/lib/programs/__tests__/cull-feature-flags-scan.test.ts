import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanFlagCallSites } from '@lib/programs/cull-feature-flags/scan';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cull-scan-'));
}

function writeFile(dir: string, relativePath: string, content: string): void {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('scanFlagCallSites', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('records one literal call site per flag api with file and line', async () => {
    writeFile(
      tmpDir,
      'src/app/dashboard/page.tsx',
      [
        'import { useFeatureFlagEnabled, useFeatureFlagPayload, useFeatureFlagVariantKey } from "@posthog/react";',
        'const a = useFeatureFlagEnabled("new-checkout");',
        "const b = useFeatureFlagPayload('ai-summaries');",
        'const c = useFeatureFlagVariantKey(`signup-cta-variant`);',
        'if (!posthog.isFeatureEnabled("export-csv")) {}',
        'const d = await client.getFeatureFlag("old-pricing-test", distinctId);',
        'const e = await client.getFeatureFlagPayload("payload-flag", distinctId);',
        'const f = posthog.getFeatureFlagResult("result-flag");',
      ].join('\n'),
    );

    const result = await scanFlagCallSites(tmpDir);

    expect(result.callSites).toEqual([
      {
        key: 'new-checkout',
        file: 'src/app/dashboard/page.tsx',
        line: 2,
        api: 'useFeatureFlagEnabled',
      },
      {
        key: 'ai-summaries',
        file: 'src/app/dashboard/page.tsx',
        line: 3,
        api: 'useFeatureFlagPayload',
      },
      {
        key: 'signup-cta-variant',
        file: 'src/app/dashboard/page.tsx',
        line: 4,
        api: 'useFeatureFlagVariantKey',
      },
      {
        key: 'export-csv',
        file: 'src/app/dashboard/page.tsx',
        line: 5,
        api: 'isFeatureEnabled',
      },
      {
        key: 'old-pricing-test',
        file: 'src/app/dashboard/page.tsx',
        line: 6,
        api: 'getFeatureFlag',
      },
      {
        key: 'payload-flag',
        file: 'src/app/dashboard/page.tsx',
        line: 7,
        api: 'getFeatureFlagPayload',
      },
      {
        key: 'result-flag',
        file: 'src/app/dashboard/page.tsx',
        line: 8,
        api: 'getFeatureFlagResult',
      },
    ]);
    expect(result.dynamicSites).toEqual([]);
    expect(result.filesScanned).toBe(1);
    expect(result.truncated).toBe(false);
  });

  test('records PostHogFeature components as call sites', async () => {
    writeFile(
      tmpDir,
      'src/app/page.tsx',
      [
        '<PostHogFeature flag="new-nav" match={true}>',
        "<PostHogFeature match={true} flag={'beta-nav'}>",
        '<PostHogFeature flag={dynamicKey}>',
      ].join('\n'),
    );

    const result = await scanFlagCallSites(tmpDir);

    expect(result.callSites.map((site) => [site.key, site.line])).toEqual([
      ['new-nav', 1],
      ['beta-nav', 2],
    ]);
    expect(result.dynamicSites).toEqual([
      { file: 'src/app/page.tsx', line: 3, api: 'PostHogFeature' },
    ]);
  });

  test('records non-literal first arguments as dynamic sites', async () => {
    writeFile(
      tmpDir,
      'src/lib/flags.ts',
      [
        'export function isOn(key: string) { return posthog.isFeatureEnabled(key); }',
        'const variant = posthog.getFeatureFlag(FLAGS.pricing);',
      ].join('\n'),
    );

    const result = await scanFlagCallSites(tmpDir);

    expect(result.callSites).toEqual([]);
    expect(result.dynamicSites).toEqual([
      { file: 'src/lib/flags.ts', line: 1, api: 'isFeatureEnabled' },
      { file: 'src/lib/flags.ts', line: 2, api: 'getFeatureFlag' },
    ]);
  });

  test('flags bulk evaluation and counts known keys read from its result as call sites', async () => {
    writeFile(
      tmpDir,
      'src/app/pricing/page.tsx',
      [
        'const flags = client ? await client.getAllFlags(distinctId) : {};',
        'const showAnnualDiscount = flags["annual-discount"] === true;',
        '// flags["retired-discount"] used to live here',
      ].join('\n'),
    );

    const result = await scanFlagCallSites(tmpDir, [
      'annual-discount',
      'retired-discount',
    ]);

    expect(result.usesBulkEvaluation).toBe(true);
    expect(result.callSites).toEqual([
      {
        key: 'annual-discount',
        file: 'src/app/pricing/page.tsx',
        line: 2,
        api: 'getAllFlags',
      },
    ]);
    expect(result.mentionSites).toEqual([
      { key: 'retired-discount', file: 'src/app/pricing/page.tsx', line: 3 },
    ]);
  });

  test('ignores calls inside comments but records known keys mentioned there', async () => {
    writeFile(
      tmpDir,
      'src/app/page.tsx',
      [
        '// const old = useFeatureFlagEnabled("legacy-banner");',
        '/* posthog.isFeatureEnabled("block-flag") */',
        '/*',
        ' * useFeatureFlagEnabled("multi-line-flag")',
        ' */',
        '// Holiday promo banner removed; flag "holiday-promo" is still in PostHog.',
        'const live = useFeatureFlagEnabled("live-flag"); // was "old-flag"',
      ].join('\n'),
    );

    const result = await scanFlagCallSites(tmpDir, [
      'holiday-promo',
      'live-flag',
      'old-flag',
      'legacy-banner',
    ]);

    expect(result.callSites).toEqual([
      {
        key: 'live-flag',
        file: 'src/app/page.tsx',
        line: 7,
        api: 'useFeatureFlagEnabled',
      },
    ]);
    expect(result.mentionSites).toEqual([
      { key: 'legacy-banner', file: 'src/app/page.tsx', line: 1 },
      { key: 'holiday-promo', file: 'src/app/page.tsx', line: 6 },
      { key: 'old-flag', file: 'src/app/page.tsx', line: 7 },
    ]);
  });

  test('marks Next.js convention entries and imported modules as reachable', async () => {
    writeFile(
      tmpDir,
      'src/app/layout.tsx',
      'import { useDarkMode } from "@/lib/flags";',
    );
    writeFile(tmpDir, 'src/proxy.ts', 'export const proxy = 1;');
    writeFile(
      tmpDir,
      'src/lib/flags.ts',
      'export const useDarkMode = () => useFeatureFlagEnabled("dark-mode");',
    );
    writeFile(
      tmpDir,
      'src/lib/unused/legacyTheme.ts',
      'posthog.isFeatureEnabled("legacy-theme");',
    );
    writeFile(tmpDir, 'src/components/index.ts', 'export {};');
    writeFile(
      tmpDir,
      'src/app/page.tsx',
      'import { Header } from "../components";',
    );

    const result = await scanFlagCallSites(tmpDir);

    expect(result.reachableFiles).toEqual([
      'src/app/layout.tsx',
      'src/app/page.tsx',
      'src/components/index.ts',
      'src/lib/flags.ts',
      'src/proxy.ts',
    ]);
  });

  test('metadata routes and side-effect imports remain reachable', async () => {
    writeFile(
      tmpDir,
      'src/app/sitemap.ts',
      'export default function sitemap() {}',
    );
    writeFile(
      tmpDir,
      'src/app/robots.ts',
      'export default function robots() {}',
    );
    writeFile(
      tmpDir,
      'src/app/opengraph-image.tsx',
      'export default function Image() {}',
    );
    writeFile(tmpDir, 'src/app/layout.tsx', 'import "../lib/register";');
    writeFile(
      tmpDir,
      'src/lib/register.ts',
      'posthog.isFeatureEnabled("boot-flag");',
    );

    const result = await scanFlagCallSites(tmpDir);

    expect(result.reachableFiles).toEqual([
      'src/app/layout.tsx',
      'src/app/opengraph-image.tsx',
      'src/app/robots.ts',
      'src/app/sitemap.ts',
      'src/lib/register.ts',
    ]);
  });

  test('skips node_modules and build output', async () => {
    writeFile(
      tmpDir,
      'node_modules/posthog-js/index.js',
      'isFeatureEnabled("vendored");',
    );
    writeFile(tmpDir, '.next/server/page.js', 'isFeatureEnabled("built");');
    writeFile(tmpDir, 'src/a.ts', 'isFeatureEnabled("real");');

    const result = await scanFlagCallSites(tmpDir);

    expect(result.callSites.map((site) => site.key)).toEqual(['real']);
    expect(result.filesScanned).toBe(1);
  });
});
