export enum ServiceHealthStatus {
  Healthy = 'healthy',
  Degraded = 'degraded',
  Down = 'down',
  /**
   * Probe failed (network error, timeout, DNS failure) AND we have no
   * corroborating status-page incident. The service may be fine — the
   * user's network is the likely culprit. Distinct from `Down`, which
   * is confirmed (HTTP 5xx or status-page incident). User-facing label:
   * "No connection".
   */
  NoConnection = 'no-connection',
}

export interface BaseHealthResult {
  status: ServiceHealthStatus;
  rawIndicator?: string;
  error?: string;
}

export interface ComponentStatus {
  name: string;
  status: ServiceHealthStatus;
  rawStatus: string;
}

export interface ComponentHealthResult extends BaseHealthResult {
  degradedOrDownComponents?: ComponentStatus[];
}

export interface AllServicesHealth {
  anthropic: BaseHealthResult;
  posthogOverall: BaseHealthResult;
  posthogComponents: ComponentHealthResult;
  github: BaseHealthResult;
  npmOverall: BaseHealthResult;
  npmComponents: ComponentHealthResult;
  cloudflareOverall: BaseHealthResult;
  cloudflareComponents: ComponentHealthResult;
  llmGateway: BaseHealthResult;
  mcp: BaseHealthResult;
  githubReleases: BaseHealthResult;
}

export type HealthCheckKey = keyof AllServicesHealth;
