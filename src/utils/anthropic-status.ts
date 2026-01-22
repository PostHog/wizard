import clack from './clack';
import chalk from 'chalk';

const CLAUDE_STATUS_URL = 'https://status.claude.com/api/v2/status.json';
const CLAUDE_STATUS_PAGE = 'https://status.claude.com';

type StatusIndicator = 'none' | 'minor' | 'major' | 'critical';

interface ClaudeStatusResponse {
  page: {
    id: string;
    name: string;
    url: string;
    time_zone: string;
    updated_at: string;
  };
  status: {
    indicator: StatusIndicator;
    description: string;
  };
}

export type StatusCheckResult =
  | { status: 'operational' }
  | { status: 'degraded'; description: string }
  | { status: 'down'; description: string }
  | { status: 'unknown'; error: string };

/**
 * Check the Anthropic/Claude status page for service health.
 * Returns the current status indicator.
 */
export async function checkAnthropicStatus(): Promise<StatusCheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(CLAUDE_STATUS_URL, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        status: 'unknown',
        error: `Status page returned ${response.status}`,
      };
    }

    const data = (await response.json()) as ClaudeStatusResponse;
    const indicator = data.status.indicator;
    const description = data.status.description;

    switch (indicator) {
      case 'none':
        return { status: 'operational' };
      case 'minor':
        return { status: 'degraded', description };
      case 'major':
      case 'critical':
        return { status: 'down', description };
      default:
        return { status: 'unknown', error: `Unknown indicator: ${indicator}` };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'unknown', error: 'Request timed out' };
    }
    return {
      status: 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check Anthropic status and handle the result.
 * - If down: Show error and exit
 * - If degraded: Show warning and ask user to continue
 * - If operational or unknown: Continue silently
 *
 * @returns true if the wizard should continue, false if it should abort
 */
export async function checkAnthropicStatusWithPrompt(
  options: { ci?: boolean } = {},
): Promise<boolean> {
  const result = await checkAnthropicStatus();

  if (result.status === 'down') {
    clack.log.error(
      `${chalk.red(
        'Claude/Anthropic services are currently experiencing issues.',
      )}

${chalk.yellow('Status:')} ${result.description}
${chalk.yellow('Status page:')} ${CLAUDE_STATUS_PAGE}

The wizard relies on Claude to make changes to your project.
Please check the status page and try again later.`,
    );
    return false;
  }

  if (result.status === 'degraded') {
    clack.log.warn(
      `${chalk.yellow('Claude/Anthropic services are partially degraded.')}

${chalk.yellow('Status:')} ${result.description}
${chalk.yellow('Status page:')} ${CLAUDE_STATUS_PAGE}

The wizard may not work reliably while services are degraded.`,
    );

    // In CI mode, continue with a warning
    if (options.ci) {
      clack.log.info('Continuing in CI mode despite degraded status...');
      return true;
    }

    const shouldContinue = await clack.confirm({
      message: 'Do you want to continue anyway?',
      initialValue: false,
    });

    if (clack.isCancel(shouldContinue) || !shouldContinue) {
      clack.log.info('Wizard cancelled. Please try again later.');
      return false;
    }

    return true;
  }

  // For 'operational' or 'unknown' status, continue silently
  // We don't want to block users if the status check itself fails
  return true;
}
