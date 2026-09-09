import {
  ServiceHealthStatus,
  type AllServicesHealth,
  type BaseHealthResult,
  type HealthCheckKey,
} from './types';
import { checkLlmGatewayHealth, checkSkillsOriginHealth } from './endpoints';
import { logToFile } from '@utils/debug';

export const SERVICE_LABELS: Record<HealthCheckKey, string> = {
  llmGateway: 'LLM gateway',
  skillsOrigin: 'Skills download',
};

const HEALTH_CHECK_KEYS: HealthCheckKey[] = ['llmGateway', 'skillsOrigin'];

export interface HealthCheckOptions {
  /** Only the gateway URL returned by this run's token mint; never guessed. */
  gatewayUrl?: string;
  /** Defaults to the same release or local server used by skill downloads. */
  skillsBaseUrl?: string;
  /** Reuse the pre-auth skills check when checking the gateway after mint. */
  skillsHealth?: BaseHealthResult;
}

/** Direct checks of the dependencies this run uses, without status pages. */
export async function checkAllExternalServices(
  options: HealthCheckOptions = {},
): Promise<AllServicesHealth> {
  const [llmGateway, skillsOrigin] = await Promise.all([
    options.gatewayUrl ? checkLlmGatewayHealth(options.gatewayUrl) : undefined,
    options.skillsHealth ?? checkSkillsOriginHealth(options.skillsBaseUrl),
  ]);
  return { ...(llmGateway ? { llmGateway } : {}), skillsOrigin };
}

export enum WizardReadiness {
  Yes = 'yes',
  No = 'no',
  YesWithWarnings = 'yes_with_warnings',
}

export interface WizardReadinessResult {
  decision: WizardReadiness;
  health: AllServicesHealth;
  reasons: string[];
}

/**
 * A gateway failure or the failure of every skills origin interrupts the run.
 * An unprobed gateway and an inconclusive check do not produce outage warnings.
 */
export function getBlockingServiceKeys(
  health: AllServicesHealth,
): HealthCheckKey[] {
  return HEALTH_CHECK_KEYS.filter((key) => {
    const status = health[key]?.status;
    return (
      status === ServiceHealthStatus.Down ||
      status === ServiceHealthStatus.NoConnection
    );
  });
}

// Endpoint probes retry within 17.5s; run them in parallel with a final ceiling.
const READINESS_TIMEOUT_MS = 20_000;

export async function evaluateWizardReadiness(
  options: HealthCheckOptions = {},
): Promise<WizardReadinessResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const health = await Promise.race([
      checkAllExternalServices(options),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Health check timed out')),
          READINESS_TIMEOUT_MS,
        );
      }),
    ]);
    const blockingKeys = getBlockingServiceKeys(health);
    const reasons = blockingKeys.flatMap((key) => {
      const result = health[key];
      return result ? [`${SERVICE_LABELS[key]}: ${result.status}`] : [];
    });
    if (blockingKeys.length > 0) {
      logToFile(`[health-checks] blocked by: ${reasons.join(', ')}`);
    }
    return {
      decision:
        blockingKeys.length > 0 ? WizardReadiness.No : WizardReadiness.Yes,
      health,
      reasons,
    };
  } catch (err) {
    logToFile('[health-checks] check inconclusive, proceeding:', err);
    return {
      decision: WizardReadiness.Yes,
      health: {
        skillsOrigin: options.skillsHealth ?? {
          status: ServiceHealthStatus.Degraded,
          error: 'Health check did not complete',
        },
      },
      reasons: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}
