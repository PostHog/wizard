import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { offloadMcpConfig } from '@lib/agent/sdk-mcp-config';

/**
 * The SDK pushes `--mcp-config <json>` onto the spawned CLI's argv for every
 * transport server, and macOS `ps` shows another user's full argv — so the run's
 * OAuth bearer was readable by any local process. Everything here is about that
 * token never reaching a command line.
 */
const TOKEN = 'phx_not_a_real_token';

const httpServer = {
  type: 'http' as const,
  url: 'https://mcp.posthog.com/mcp',
  headers: { Authorization: `Bearer ${TOKEN}` },
};

describe('offloadMcpConfig', () => {
  it('keeps the bearer out of what the SDK can serialize', () => {
    const cfg = offloadMcpConfig({ 'posthog-wizard': httpServer });
    expect(JSON.stringify(cfg.mcpServers)).not.toContain(TOKEN);
    expect(JSON.stringify(cfg.extraArgs)).not.toContain(TOKEN);
    cfg.dispose();
  });

  it('hands the CLI a path, and the file holds the real config', () => {
    const cfg = offloadMcpConfig({ 'posthog-wizard': httpServer });
    const path = cfg.extraArgs?.['mcp-config'];
    expect(path).toBeDefined();
    expect(JSON.parse(readFileSync(path!, 'utf8'))).toEqual({
      mcpServers: { 'posthog-wizard': httpServer },
    });
    cfg.dispose();
  });

  it('writes it unreadable by anyone else', () => {
    const cfg = offloadMcpConfig({ 'posthog-wizard': httpServer });
    const path = cfg.extraArgs!['mcp-config'];
    expect(statSync(path).mode & 0o077).toBe(0);
    expect(statSync(dirname(path)).mode & 0o077).toBe(0);
    cfg.dispose();
  });

  it('leaves in-process servers alone — the SDK never puts those on argv', () => {
    const wizardTools = { type: 'sdk' as const, name: 'wizard-tools' };
    const cfg = offloadMcpConfig({
      'wizard-tools': wizardTools,
      'posthog-wizard': httpServer,
    });
    expect(cfg.mcpServers).toEqual({ 'wizard-tools': wizardTools });
    cfg.dispose();
  });

  it('writes no file when there is nothing to hide', () => {
    const cfg = offloadMcpConfig({
      'wizard-tools': { type: 'sdk' as const, name: 'wizard-tools' },
    });
    expect(cfg.extraArgs).toBeUndefined();
  });

  it('deletes the file on dispose', () => {
    const cfg = offloadMcpConfig({ 'posthog-wizard': httpServer });
    const path = cfg.extraArgs!['mcp-config'];
    cfg.dispose();
    expect(existsSync(path)).toBe(false);
  });
});
