/**
 * McpDemo — Playground demo for the MCP client selection screen.
 *
 * Uses a mock McpInstaller that simulates detecting three editors,
 * a short install delay, and a successful result.
 */

import { WizardStore } from '@ui/tui/store';
import { McpScreen } from '@ui/tui/screens/McpScreen';
import type { McpInstaller } from '@ui/tui/services/mcp-installer';

const MOCK_CLIENTS = [
  { name: 'Claude Code', supportsPlugin: true },
  { name: 'Cursor', supportsPlugin: true },
  { name: 'VS Code', supportsPlugin: false },
];

function createMockInstaller(): McpInstaller {
  return {
    async detectClients() {
      await new Promise((r) => setTimeout(r, 800));
      return MOCK_CLIENTS;
    },
    async install(clientNames) {
      await new Promise((r) => setTimeout(r, 1500));
      return clientNames;
    },
    async installPlugins(clientNames) {
      await new Promise((r) => setTimeout(r, 800));
      const installed = clientNames.filter(
        (name) => MOCK_CLIENTS.find((c) => c.name === name)?.supportsPlugin,
      );
      return { installed, outdated: [] };
    },
    async remove() {
      await new Promise((r) => setTimeout(r, 1000));
      return MOCK_CLIENTS.map((c) => c.name);
    },
  };
}

interface McpDemoProps {
  store: WizardStore;
}

export const McpDemo = ({ store }: McpDemoProps) => {
  return (
    <McpScreen store={store} installer={createMockInstaller()} mode="install" />
  );
};
