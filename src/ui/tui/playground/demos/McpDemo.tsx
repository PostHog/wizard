/**
 * McpDemo — Playground demo for the MCP client selection screen.
 *
 * Uses a mock McpInstaller that simulates detecting three editors,
 * a short install delay, and a successful result.
 */

import { WizardStore } from '@ui/tui/store';
import { McpScreen } from '@ui/tui/screens/McpScreen';
import type {
  McpInstaller,
  McpClientInfo,
} from '@ui/tui/services/mcp-installer';

const MOCK_CLIENTS: McpClientInfo[] = [
  { name: 'Claude Code', supportsPlugin: true },
  { name: 'Cursor', supportsPlugin: true },
  { name: 'VS Code', supportsPlugin: false },
  {
    name: 'Claude Desktop/Web',
    supportsPlugin: false,
    finish: {
      url: 'https://claude.ai/directory/connectors/posthog',
      instruction: 'Sign in and click "Connect" to finish.',
    },
  },
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
      return clientNames.filter(
        (name) => MOCK_CLIENTS.find((c) => c.name === name)?.supportsPlugin,
      );
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
