const CLAUDE_STATUS_URL = 'https://status.claude.com/api/v2/status.json';

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
 * Pure function — no UI calls.
 */
export async function checkAnthropicStatus(): Promise<StatusCheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

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
