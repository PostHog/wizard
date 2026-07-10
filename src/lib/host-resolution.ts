/**
 * HostResolution — the single, immutable snapshot of where the wizard talks to
 * PostHog for one run.
 *
 * One cloud region (or a pinned `--base-url`) implies a whole family of hosts:
 * the event-ingestion/API host, the user-facing web app host, the CDN asset
 * host, the LLM gateway, and the MCP server. Rather than re-deriving each of
 * these at every call site and threading `region` + `baseUrl` around as loose
 * params, resolve once at auth time and pass this frozen object around — read
 * the property you need.
 *
 * The actual region→URL math (and the `--base-url` override) lives in
 * `@utils/urls`; this class is a thin, immutable façade over those resolvers so
 * the override flows through every field without callers having to know about
 * it. The OAuth-server URL stays in `@utils/urls` (`getOAuthUrl`) because it is
 * needed *before* a region is known, so it can't come from this post-auth object.
 */

import {
  getHost,
  getCloudUrl,
  getLlmGatewayUrl,
  getUiHostFromHost,
  detectRegion,
  resolveBaseUrl,
} from '@utils/urls';
import { runtimeEnv } from '@env';
import type { CloudRegion } from '@utils/types';

const LOCAL_MCP_BASE = 'http://localhost:8787/mcp';
const PROD_MCP_BASE = 'https://mcp.posthog.com/mcp';

/**
 * The MCP server's tool-surface modes: `tools` serves the ~252-named-tool
 * roster, `cli` serves a single `exec` tool that reaches the same catalog
 * through command strings. A url without a `mode` param gets the server
 * default, which is CLI mode for the wizard's client (only Cursor and ChatGPT
 * are allowlisted to keep the named roster).
 */
export type McpMode = 'tools' | 'cli';

/** Construction-time inputs that aren't implied by the region. */
export interface HostResolutionOptions {
  /** `--local-mcp`: point the agent's MCP url at the local dev server. */
  localMcp?: boolean;
  /** `--base-url`: pin every PostHog origin to one URL, bypassing region resolution. */
  baseUrl?: string;
  /** `--region`: trust the explicitly-provided region. */
  region?: CloudRegion;
}

function assetHostFor(region: CloudRegion, baseUrl?: string): string {
  const override = resolveBaseUrl(baseUrl);
  if (override) return override;
  return region === 'eu'
    ? 'https://eu-assets.i.posthog.com'
    : 'https://us-assets.i.posthog.com';
}

function assetHostFromApiHost(apiHost: string): string {
  if (apiHost.includes('us.i.posthog.com')) {
    return 'https://us-assets.i.posthog.com';
  }
  if (apiHost.includes('eu.i.posthog.com')) {
    return 'https://eu-assets.i.posthog.com';
  }
  return apiHost;
}

export interface McpUrlOptions {
  /** `--local-mcp`: point at the local dev MCP server. Wins over `MCP_URL`. */
  local?: boolean;
  /**
   * Tool-surface mode to pin on the url; omitted → the server default. The
   * wizard's internal agent connections pass `'tools'` — their prompts and
   * installed skills still speak the named-tool roster.
   * TODO(#849): drop the pins once both harnesses run on the single-exec CLI mode.
   */
  mode?: McpMode;
  /** `features=` filter narrowing the tool catalog the url can reach. */
  features?: string[];
}

/**
 * The one place an MCP server url is built. One url for every region — the
 * server resolves the user's region from the bearer token. Two overrides:
 * `MCP_URL` (dev: point at any server) replaces the whole url verbatim, and
 * `POSTHOG_WIZARD_MCP_MODE` / `--mcp-mode` (the field kill switch for the
 * CLI-mode migration, #842) wins over the requested mode.
 */
export function mcpUrlFor(opts: McpUrlOptions = {}): string {
  if (!opts.local) {
    const urlOverride = runtimeEnv('MCP_URL');
    if (urlOverride) return urlOverride;
  }
  const params: string[] = [];
  if (opts.features && opts.features.length > 0) {
    params.push(`features=${opts.features.join(',')}`);
  }
  const envMode = runtimeEnv('POSTHOG_WIZARD_MCP_MODE');
  const mode = envMode === 'tools' || envMode === 'cli' ? envMode : opts.mode;
  if (mode) params.push(`mode=${mode}`);
  const base = opts.local ? LOCAL_MCP_BASE : PROD_MCP_BASE;
  return params.length > 0 ? `${base}?${params.join('&')}` : base;
}

export class HostResolution {
  /** The resolved cloud region. `'us'` when a base URL is pinned. */
  readonly region: CloudRegion;
  /**
   * Event-ingestion / REST API host (e.g. `https://us.i.posthog.com`, or the
   * pinned `--base-url`). The SDK `host` written into the user's `.env`, the
   * base for the wizard-session REST calls, and the host shown to the agent.
   */
  readonly apiHost: string;
  /**
   * User-facing web app host (e.g. `https://us.posthog.com`). Use for any link
   * we hand to the user or open in their browser (dashboards, settings, inbox,
   * deep-link base).
   */
  readonly appHost: string;
  /** CDN asset host (e.g. `https://us-assets.i.posthog.com`). */
  readonly assetHost: string;
  /** PostHog LLM gateway URL the agent SDK authenticates its model calls against. */
  readonly gatewayUrl: string;
  /**
   * PostHog MCP server URL the agent connects to. Region-independent — the
   * server resolves the user's region from the bearer token — so this is driven
   * only by `--local-mcp` and the `MCP_URL` override, not by region/base-url.
   * Pinned to the named-tool roster (`mode=tools`), like every internal agent
   * connection.
   */
  readonly mcpUrl: string;

  private constructor(fields: {
    region: CloudRegion;
    apiHost: string;
    appHost: string;
    assetHost: string;
    gatewayUrl: string;
    mcpUrl: string;
  }) {
    this.region = fields.region;
    this.apiHost = fields.apiHost;
    this.appHost = fields.appHost;
    this.assetHost = fields.assetHost;
    this.gatewayUrl = fields.gatewayUrl;
    this.mcpUrl = fields.mcpUrl;
    Object.freeze(this);
  }

  /**
   * Canonical path: build the host family from a resolved region. A pinned
   * `--base-url` (via `opts.baseUrl`) wins for every origin; otherwise the
   * region's standard hosts are used. Honors IS_DEV through `resolveBaseUrl`.
   */
  static fromRegion(
    region: CloudRegion,
    opts: HostResolutionOptions = {},
  ): HostResolution {
    const apiHost = getHost(region, opts.baseUrl);
    return new HostResolution({
      region,
      apiHost,
      appHost: getCloudUrl(region, opts.baseUrl),
      assetHost: assetHostFor(region, opts.baseUrl),
      gatewayUrl: getLlmGatewayUrl(apiHost),
      mcpUrl: mcpUrlFor({ local: opts.localMcp, mode: 'tools' }),
    });
  }

  /**
   * Build from an ingestion host string (the provisioning API returns one). The
   * given host is preserved verbatim as `apiHost`; the region and the derived
   * app/asset/gateway hosts are inferred from it.
   */
  static fromApiHost(
    apiHost: string,
    opts: Pick<HostResolutionOptions, 'localMcp'> = {},
  ): HostResolution {
    const region: CloudRegion = apiHost.includes('eu.') ? 'eu' : 'us';
    return new HostResolution({
      region,
      apiHost,
      appHost: getUiHostFromHost(apiHost),
      assetHost: assetHostFromApiHost(apiHost),
      gatewayUrl: getLlmGatewayUrl(apiHost),
      mcpUrl: mcpUrlFor({ local: opts.localMcp, mode: 'tools' }),
    });
  }

  /**
   * Resolve the region from an access token (the us/eu probe, skipped when a
   * base URL is pinned), then build the host family. Used after OAuth and after
   * CI-mode API-key auth.
   */
  static async fromAccessToken(
    accessToken: string,
    opts: HostResolutionOptions = {},
  ): Promise<HostResolution> {
    const region =
      opts.region ?? (await detectRegion(accessToken, opts.baseUrl));
    return HostResolution.fromRegion(region, opts);
  }
}
