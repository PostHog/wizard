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
import type { CatalogTool, SourceDetector } from './types.js';

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

// The string contracts below match the ones PostHog enforces on its side. A
// value that fails one rejects only its tool entry.
const KIND = /^[A-Za-z0-9]{1,64}$/;
const LABEL = /^[\w .,&()+/'!-]{1,80}$/;
const COMPETES_WITH = /^[a-z_]{1,64}$/;
const PACKAGE_NAME = /^[A-Za-z0-9@/._:+~-]{1,214}$/;
const SCRIPT_HOST = /^[a-z0-9.-]{1,253}$/;
// A `^`, then literal characters or groups of literal alternatives, each
// optionally followed by `?`, and an optional `$`. Patterns of this shape
// cannot backtrack catastrophically, so a catalog entry cannot stall a scan.
const ENV_KEY_PATTERN =
  /^\^(?:(?:[A-Za-z0-9_]|\((?:[A-Za-z0-9_]+\|)*[A-Za-z0-9_]+\))\??)+\$?$/;

const catalogToolSchema: z.ZodType<CatalogTool, z.ZodTypeDef, unknown> =
  z.object({
    kind: z.string().regex(KIND),
    label: z.string().regex(LABEL),
    warehouse_source_type: z.string().regex(KIND).nullable(),
    wizard_setup_mode: z.enum(['in-cli', 'deep-link']).nullable(),
    competes_with: z.array(z.string().regex(COMPETES_WITH)),
    superseded_by: z.array(z.string().regex(KIND)),
    signals: z.object({
      env_key_patterns: z.array(z.string().regex(ENV_KEY_PATTERN)),
      script_hosts: z.array(z.string().regex(SCRIPT_HOST)),
      packages: z.record(z.string(), z.array(z.string().regex(PACKAGE_NAME))),
    }),
  });

// A catalog with another schema_version may change what a field means, so it
// is rejected outright rather than read with this version's rules. Tool
// entries are checked one at a time, so one bad entry does not cost the rest.
const catalogEnvelopeSchema = z.object({
  schema_version: z.literal(1),
  tools: z.array(z.unknown()),
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

/**
 * Reads a downloaded catalog body. Throws when the body is not a version 1
 * catalog. Skips a tool entry that fails validation, and logs it.
 */
export function toSourceDetectors(body: unknown): SourceDetector[] {
  const catalog = catalogEnvelopeSchema.safeParse(body);
  if (!catalog.success) {
    throw new Error(`unreadable catalog: ${catalog.error.message}`);
  }
  const detectors: SourceDetector[] = [];
  catalog.data.tools.forEach((entry, index) => {
    const tool = catalogToolSchema.safeParse(entry);
    if (tool.success) {
      detectors.push(toDetector(tool.data));
    } else {
      const reason = tool.error.message.slice(0, 500);
      logToFile(`[tool-catalog] skipped tool ${index}: ${reason}`);
    }
  });
  return detectors;
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
  return toSourceDetectors(await response.json());
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
