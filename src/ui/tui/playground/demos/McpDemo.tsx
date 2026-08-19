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
import { McpClientStatus } from '@steps/add-mcp-server-to-clients/results';

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
      // Mixed outcomes so the demo shows every Done-phase section.
      return clientNames.map((name, i) => ({
        name,
        status:
          i === 1 ? McpClientStatus.Unchanged : McpClientStatus.Changed,
      }));
    },
    async installPlugins(clientNames) {
      await new Promise((r) => setTimeout(r, 800));
      return clientNames
        .filter(
          (name) => MOCK_CLIENTS.find((c) => c.name === name)?.supportsPlugin,
        )
        .map((name) => ({ name, status: McpClientStatus.Changed }));
    },
    async remove() {
      await new Promise((r) => setTimeout(r, 1000));
      // Mixed outcomes so the demo shows the removal failure copy too.
      return MOCK_CLIENTS.map((c, i) =>
        i === 2
          ? {
              name: c.name,
              status: McpClientStatus.Failed,
              detail: 'EACCES: permission denied',
            }
          : { name: c.name, status: McpClientStatus.Changed },
      );
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
