/**
 * Registry of data warehouse source detectors, built from PostHog's tool
 * catalog. The wizard downloads the catalog at runtime, so a tool added in
 * PostHog reaches every installed wizard without a release. Edit the catalog
 * in PostHog, not here.
 */

import { z } from 'zod';
import { WIZARD_USER_AGENT } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { resolveBaseUrl } from '@utils/urls';
import type { CatalogTool, SourceDetector, ToolCatalog } from './types.js';

const CATALOG_API_PATH = '/api/wizard/tool_catalog/';

type CatalogSource = { name: string; url: string };

/** Tried in order after a pinned PostHog host. GitHub serves the same file when both regions are down. */
const PUBLIC_CATALOG_SOURCES: readonly CatalogSource[] = [
  { name: 'us', url: `https://us.posthog.com${CATALOG_API_PATH}` },
  { name: 'eu', url: `https://eu.posthog.com${CATALOG_API_PATH}` },
  {
    name: 'github',
    url: 'https://raw.githubusercontent.com/PostHog/posthog/master/products/wizard/tool-catalog.generated.json',
  },
];

// Per source. Detection waits on the download, so a hung host must not hold up the run.
const FETCH_TIMEOUT_MS = 5_000;

const catalogToolSchema = z.object({
  kind: z.string().min(1),
  label: z.string(),
  warehouse_source_type: z.string().nullable(),
  wizard_setup_mode: z.enum(['in-cli', 'deep-link']).nullable(),
  competes_with: z.array(z.string()),
  superseded_by: z.array(z.string()),
  signals: z.object({
    env_key_patterns: z.array(z.string()),
    script_hosts: z.array(z.string()),
    packages: z.record(z.string(), z.array(z.string())),
  }),
});

// A catalog with another schema_version may change what a field means, so it
// is rejected outright rather than read with this version's rules.
const toolCatalogSchema: z.ZodType<ToolCatalog, z.ZodTypeDef, unknown> =
  z.object({
    schema_version: z.literal(1),
    tools: z.array(catalogToolSchema),
  });

function toDetector(tool: CatalogTool): SourceDetector {
  return {
    kind: tool.kind,
    label: tool.label,
    warehouseSourceType: tool.warehouse_source_type,
    mode: tool.wizard_setup_mode,
    signals: {
      envKeys: tool.signals.env_key_patterns.map(
        (pattern) => new RegExp(pattern),
      ),
      scriptHosts: tool.signals.script_hosts,
      packages: tool.signals.packages,
    },
    supersededBy: tool.superseded_by,
  };
}

/** Throws when a pattern does not compile, which the loader treats as a malformed catalog. */
export function toSourceDetectors(catalog: ToolCatalog): SourceDetector[] {
  return catalog.tools.map(toDetector);
}

function catalogSources(baseUrl: string | undefined): CatalogSource[] {
  const pinned = resolveBaseUrl(baseUrl);
  if (!pinned) return [...PUBLIC_CATALOG_SOURCES];
  return [
    {
      name: 'pinned',
      url: `${pinned.replace(/\/+$/, '')}${CATALOG_API_PATH}`,
    },
    ...PUBLIC_CATALOG_SOURCES,
  ];
}

async function fetchDetectors(url: string): Promise<SourceDetector[]> {
  const response = await fetch(url, {
    headers: { 'User-Agent': WIZARD_USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const parsed = toolCatalogSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(`unreadable catalog: ${parsed.error.message}`);
  }
  return toSourceDetectors(parsed.data);
}

async function downloadDetectors(
  baseUrl: string | undefined,
): Promise<readonly SourceDetector[]> {
  const failures: Record<string, string> = {};
  for (const { name, url } of catalogSources(baseUrl)) {
    try {
      const detectors = await fetchDetectors(url);
      logToFile(`[tool-catalog] loaded ${detectors.length} tools from ${url}`);
      return detectors;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logToFile(`[tool-catalog] ${url} failed: ${message}`);
      failures[name] = message.slice(0, 200);
    }
  }
  // With no catalog every scan comes back empty. The event keeps those runs
  // apart from projects that really use no catalog tool.
  analytics.wizardCapture('tool catalog unavailable', { failures });
  return [];
}

let loading: Promise<readonly SourceDetector[]> | null = null;

/**
 * The detectors from PostHog's tool catalog. Tries a pinned PostHog host
 * (`--base-url`, `--local-posthog`, dev builds) first, then US, EU and GitHub.
 * Resolves to an empty list when every source fails, and never rejects.
 *
 * Every caller in the process shares the first call's download. The base URL
 * is fixed for a run, so the first caller's `baseUrl` is everyone's.
 */
export function loadSourceDetectors(
  baseUrl?: string,
): Promise<readonly SourceDetector[]> {
  loading ??= downloadDetectors(baseUrl);
  return loading;
}

/** Tests only. */
export function resetSourceDetectors(): void {
  loading = null;
}
