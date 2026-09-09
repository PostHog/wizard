export enum ServiceHealthStatus {
  Healthy = 'healthy',
  Degraded = 'degraded',
  Down = 'down',
  /** A failed connection does not establish whether the service or local network is at fault. */
  NoConnection = 'no-connection',
}

export interface BaseHealthResult {
  status: ServiceHealthStatus;
  rawIndicator?: string;
  error?: string;
}

export interface AllServicesHealth {
  /** Absent before the token mint tells us this run's actual gateway URL. */
  llmGateway?: BaseHealthResult;
  skillsOrigin: BaseHealthResult;
}

export type HealthCheckKey = keyof AllServicesHealth;
