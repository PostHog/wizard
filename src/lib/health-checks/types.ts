export enum ServiceHealthStatus {
  Healthy = 'healthy',
  Degraded = 'degraded',
  Down = 'down',
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
}

export type HealthCheckKey = keyof AllServicesHealth;
