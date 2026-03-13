import {
  ServiceHealthStatus,
  type AllServicesHealth,
  type BaseHealthResult,
  type ComponentHealthResult,
  type HealthCheckKey,
} from './types';
import {
  checkAnthropicHealth,
  checkPosthogOverallHealth,
  checkPosthogComponentHealth,
  checkGithubHealth,
  checkNpmOverallHealth,
  checkNpmComponentHealth,
  checkCloudflareOverallHealth,
  checkCloudflareComponentHealth,
} from './statuspage';
import {
  checkLlmGatewayHealth,
  checkMcpHealth,
  checkGithubReleasesHealth,
} from './endpoints';
import { logToFile } from '../../utils/debug';

// ---------------------------------------------------------------------------
// Service labels (used in human-readable reason strings)
// ---------------------------------------------------------------------------

export const SERVICE_LABELS: Record<HealthCheckKey, string> = {
  anthropic: 'Anthropic',
  posthogOverall: 'PostHog',
  posthogComponents: 'PostHog (components)',
  github: 'GitHub',
  npmOverall: 'npm',
  npmComponents: 'npm (components)',
  cloudflareOverall: 'Cloudflare',
  cloudflareComponents: 'Cloudflare (components)',
  llmGateway: 'LLM Gateway',
  mcp: 'MCP',
  githubReleases: 'GitHub Releases',
};

// ---------------------------------------------------------------------------
// Readiness config
// ---------------------------------------------------------------------------

export interface WizardReadinessConfig {
  /** Services where status=Down blocks the run (readiness=No). */
  downBlocksRun: HealthCheckKey[];
  /** Services where status=Degraded (or worse) blocks the run (readiness=No). */
  degradedBlocksRun?: HealthCheckKey[];
}

/**
 * See README section "Health checks" for the full rationale.
 * Adjust these arrays to change what blocks a wizard run.
 */
export const DEFAULT_WIZARD_READINESS_CONFIG: WizardReadinessConfig = {
  downBlocksRun: [
    'anthropic',
    'posthogOverall',
    'npmOverall',
    'llmGateway',
    'mcp',
    'githubReleases',
  ],
  degradedBlocksRun: ['anthropic'],
};

// ---------------------------------------------------------------------------
// Aggregate check
// ---------------------------------------------------------------------------

export async function checkAllExternalServices(): Promise<AllServicesHealth> {
  const [
    anthropic,
    posthogOverall,
    posthogComponents,
    github,
    npmOverall,
    npmComponents,
    cloudflareOverall,
    cloudflareComponents,
    llmGateway,
    mcp,
    githubReleases,
  ] = await Promise.all([
    checkAnthropicHealth(),
    checkPosthogOverallHealth(),
    checkPosthogComponentHealth(),
    checkGithubHealth(),
    checkNpmOverallHealth(),
    checkNpmComponentHealth(),
    checkCloudflareOverallHealth(),
    checkCloudflareComponentHealth(),
    checkLlmGatewayHealth(),
    checkMcpHealth(),
    checkGithubReleasesHealth(),
  ]);

  return {
    anthropic,
    posthogOverall,
    posthogComponents,
    github,
    npmOverall,
    npmComponents,
    cloudflareOverall,
    cloudflareComponents,
    llmGateway,
    mcp,
    githubReleases,
  };
}

// ---------------------------------------------------------------------------
// Wizard readiness evaluation
// ---------------------------------------------------------------------------

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

function describeResult(label: string, h: BaseHealthResult): string {
  const parts = [`${label}: ${h.status}`];
  if (h.rawIndicator) parts.push(`indicator=${h.rawIndicator}`);
  if (h.error) parts.push(h.error);
  return parts.join(' — ');
}

const MAX_COMPONENT_NAMES = 8;

function describeComponents(label: string, h: ComponentHealthResult): string {
  const affected = h.degradedOrDownComponents;
  if (!affected || affected.length === 0)
    return `${label} components: all operational`;
  const shown = affected
    .slice(0, MAX_COMPONENT_NAMES)
    .map((c) => `${c.name} (${c.status})`);
  const suffix =
    affected.length > MAX_COMPONENT_NAMES
      ? `, +${affected.length - MAX_COMPONENT_NAMES} more`
      : '';
  return `${label} components impacted: ${shown.join(', ')}${suffix}`;
}

const READINESS_TIMEOUT_MS = 10_000;

export async function evaluateWizardReadiness(
  config: WizardReadinessConfig = DEFAULT_WIZARD_READINESS_CONFIG,
): Promise<WizardReadinessResult> {
  try {
    const health = await Promise.race([
      checkAllExternalServices(),
      new Promise<AllServicesHealth>((resolve) =>
        setTimeout(
          () => resolve(allUnknown('Health check timed out')),
          READINESS_TIMEOUT_MS,
        ),
      ),
    ]);

    const reasons: string[] = [];

    for (const key of Object.keys(health) as HealthCheckKey[]) {
      const result = health[key];
      const label = SERVICE_LABELS[key];

      reasons.push(describeResult(label, result));

      if ('degradedOrDownComponents' in result) {
        reasons.push(describeComponents(label, result));
      }
    }

    const blockingKeys = getBlockingServiceKeys(health, config);
    if (blockingKeys.length > 0) {
      logToFile(`[health-checks] blocked by: ${blockingKeys.join(', ')}`);
      return { decision: WizardReadiness.No, health, reasons };
    }

    const hasWarnings = Object.values(health).some(
      (h) => h.status !== ServiceHealthStatus.Healthy,
    );

    if (hasWarnings) {
      return { decision: WizardReadiness.YesWithWarnings, health, reasons };
    }

    return { decision: WizardReadiness.Yes, health, reasons };
  } catch (err) {
    logToFile(
      `[health-checks] error: ${err instanceof Error ? err.message : err}`,
    );
    // Health checks must never block the wizard run
    return {
      decision: WizardReadiness.Yes,
      health: allUnknown('Unexpected error'),
      reasons: ['Health check failed unexpectedly — proceeding anyway'],
    };
  }
}

// ---------------------------------------------------------------------------
// Blocking service detection
// ---------------------------------------------------------------------------

/** Keys that are component-level detail, not top-level services. */
const COMPONENT_KEYS: HealthCheckKey[] = [
  'posthogComponents',
  'npmComponents',
  'cloudflareComponents',
];

/**
 * Get the keys of services that would block a wizard run per the given config.
 */
export function getBlockingServiceKeys(
  health: AllServicesHealth,
  config: WizardReadinessConfig = DEFAULT_WIZARD_READINESS_CONFIG,
): HealthCheckKey[] {
  return (Object.keys(health) as HealthCheckKey[]).filter((key) => {
    if (COMPONENT_KEYS.includes(key)) return false;
    const result = health[key];
    if (
      config.downBlocksRun.includes(key) &&
      result.status === ServiceHealthStatus.Down
    ) {
      return true;
    }
    if (
      (config.degradedBlocksRun ?? []).includes(key) &&
      result.status !== ServiceHealthStatus.Healthy
    ) {
      return true;
    }
    return false;
  });
}

/** Build an AllServicesHealth where every service is Degraded with the given error. */
function allUnknown(error: string): AllServicesHealth {
  const base: BaseHealthResult = {
    status: ServiceHealthStatus.Degraded,
    error,
  };
  return {
    anthropic: base,
    posthogOverall: base,
    posthogComponents: { ...base },
    github: base,
    npmOverall: base,
    npmComponents: { ...base },
    cloudflareOverall: base,
    cloudflareComponents: { ...base },
    llmGateway: base,
    mcp: base,
    githubReleases: base,
  };
}
