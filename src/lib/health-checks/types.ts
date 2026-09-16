export enum ServiceHealthStatus {
  Healthy = 'healthy',
  Degraded = 'degraded',
  Down = 'down',
  // A network failure does not establish a service outage.
  NoConnection = 'no-connection',
}

export interface BaseHealthResult {
  status: ServiceHealthStatus;
  rawIndicator?: string;
  error?: string;
}

export interface AllServicesHealth {
  skillsOrigin: BaseHealthResult;
}

export type HealthCheckKey = keyof AllServicesHealth;
