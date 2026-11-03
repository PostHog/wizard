import { analytics } from '@utils/analytics';
import type { ProgramSession } from '@programs/program-contract';
import { findMcpServers, type McpServerScan, type McpTarget } from './detect';

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

export function mcpTarget(session: ProgramSession): McpTarget | undefined {
  return session.frameworkContext[MCP_TARGET_KEY] as McpTarget | undefined;
}

export function mcpScan(session: ProgramSession): McpServerScan | undefined {
  return session.frameworkContext[MCP_SCAN_KEY] as McpServerScan | undefined;
}

/** The run's working directory: the selected server, else the directory the wizard started in. */
export function mcpAnalyticsTargetDir(session: ProgramSession): string {
  return mcpTarget(session)?.directory ?? session.installDir;
}
