/**
 * McpDemo — Playground demo for the MCP client selection screen.
 *
 * Uses a mock McpInstaller that simulates detecting three editors,
 * a short install delay, and a successful result.
 */

import { WizardStore } from '../../store.js';
import { McpScreen } from '../../screens/McpScreen.js';
import type { McpInstaller } from '../../services/mcp-installer.js';

const MOCK_CLIENTS = [
  { name: 'VS Code' },
  { name: 'Cursor' },
  { name: 'Windsurf' },
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
