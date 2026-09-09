import { analytics } from '@utils/analytics';
import { findMcpServers, type McpServerScan } from './detect';

export const MCP_SCAN_KEY = 'mcpAnalyticsScan';
export const MCP_SCAN_ERROR_KEY = 'mcpAnalyticsScanError';
export const MCP_TARGET_KEY = 'mcpAnalyticsTarget';

export async function scanMcpAnalyticsProject(
  directory: string,
): Promise<McpServerScan> {
  try {
    const scan = await findMcpServers(directory);
    analytics.wizardCapture('mcp analytics server scan', {
      candidate_count: scan.candidates.length,
      outcome: scan.candidates.length ? 'candidates_found' : 'no_candidates',
    });
    return scan;
  } catch (error) {
    analytics.wizardCapture('mcp analytics server scan', {
      outcome: 'unreadable_path',
    });
    throw error;
  }
}
