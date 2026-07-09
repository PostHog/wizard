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

const LOCAL_MCP_URL = 'http://localhost:8787/mcp';
const PROD_MCP_URL = 'https://mcp.posthog.com/mcp';

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

function mcpUrlFor(localMcp: boolean): string {
  if (localMcp) return LOCAL_MCP_URL;
  return runtimeEnv('MCP_URL') || PROD_MCP_URL;
}

/**
 * The wizard's internal agent runs speak the named-tool roster, so their MCP
 * url carries `mode=tools`; an explicit `mode` on the url (e.g. an `MCP_URL`
 * override) wins, so both server shapes stay reachable in dev.
 * TODO(#849): drop the pin once both harnesses run on the single-exec CLI mode.
 */
export function withMcpToolsModePin(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  if (!url.searchParams.has('mode')) {
    url.searchParams.set('mode', 'tools');
  }
  return url.toString();
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
      mcpUrl: mcpUrlFor(opts.localMcp ?? false),
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
      mcpUrl: mcpUrlFor(opts.localMcp ?? false),
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
