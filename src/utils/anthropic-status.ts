import { getUI } from '../ui';
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
    const rawDesc = data.status.description;
    const description =
      rawDesc.charAt(0).toUpperCase() + rawDesc.slice(1).toLowerCase();

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

  const ui = getUI();

  if (result.status === 'down' || result.status === 'degraded') {
    const severity =
      result.status === 'down' ? 'experiencing issues' : 'partially degraded';
    ui.log.warn(
      `${chalk.yellow(`Claude/Anthropic services are ${severity}.`)}

${chalk.yellow('Status:')} ${result.description}
${chalk.yellow('Status page:')} ${CLAUDE_STATUS_PAGE}

The wizard may not work reliably while services are affected.`,
    );

    // In CI mode, continue with a warning
    if (options.ci) {
      return true;
    }

    const shouldContinue = await ui.confirm({
      message: 'Do you want to continue anyway?',
      initialValue: true,
    });

    if (ui.isCancel(shouldContinue) || !shouldContinue) {
      ui.log.info('Wizard cancelled. Please try again later.');
      return false;
    }

    return true;
  }

  // For 'operational' or 'unknown' status, continue silently
  // We don't want to block users if the status check itself fails
  return true;
}
