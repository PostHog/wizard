/**
 * The Agent SDK serializes every transport MCP server into `--mcp-config <json>`
 * on the spawned CLI's argv, where `ps` shows the Authorization bearer to any
 * local process. The CLI also accepts a file path there, so hand it one that
 * only this user can read and keep the token off the command line.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

export interface OffloadedMcpConfig {
  /** In-process servers: the SDK keeps these off argv already. */
  mcpServers: Record<string, McpServerConfig>;
  /** `--mcp-config <path>`, omitted when nothing needed offloading. */
  extraArgs?: Record<string, string>;
  dispose(): void;
}

const isInProcess = (server: McpServerConfig): boolean =>
  (server as { type?: string }).type === 'sdk';

export function offloadMcpConfig(
  servers: Record<string, McpServerConfig>,
): OffloadedMcpConfig {
  const mcpServers: Record<string, McpServerConfig> = {};
  const transport: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(servers ?? {})) {
    (isInProcess(server) ? mcpServers : transport)[name] = server;
  }

  if (Object.keys(transport).length === 0) {
    return { mcpServers, dispose: () => undefined };
  }

  // mkdtemp is 0700, so the file stays unreadable by other users whatever the umask.
  const dir = mkdtempSync(join(tmpdir(), 'posthog-wizard-mcp-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: transport }), {
    mode: 0o600,
  });

  return {
    mcpServers,
    extraArgs: { 'mcp-config': path },
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
