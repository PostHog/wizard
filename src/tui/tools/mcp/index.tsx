/** The MCP tools' TUI: add, remove and the tutorial. */
import { McpScreen } from '@tui/screens/McpScreen';
import { setMcpOutcome } from '@tui/control/defs';
import type { TuiTool, TuiTools } from '@tui/tools/types';
import { MCP_ADD_FLOW, MCP_REMOVE_FLOW, MCP_TUTORIAL_FLOW } from './flow.js';
import { McpScreenId } from './screen-ids.js';
import { McpSuggestedPromptsScreen } from './screens/McpSuggestedPromptsScreen.js';
import { setMcpSuggestedPromptsDismissed } from './store-actions.js';
import {
  createMcpSuggestedPromptsServices,
  type McpSuggestedPromptsServices,
} from './services/suggested-prompts.js';

export { McpScreenId } from './screen-ids.js';
export type { McpSuggestedPromptsServices } from './services/suggested-prompts.js';

const screens: TuiTool['screens'] = {
  [McpScreenId.Add]: (store, services) => (
    <McpScreen store={store} installer={services.mcpInstaller} />
  ),
  [McpScreenId.Remove]: (store, services) => (
    <McpScreen store={store} installer={services.mcpInstaller} mode="remove" />
  ),
  [McpScreenId.SuggestedPrompts]: (store, services) => (
    <McpSuggestedPromptsScreen
      store={store}
      services={
        (services.programServices?.[McpScreenId.SuggestedPrompts] as
          | McpSuggestedPromptsServices
          | undefined) ?? createMcpSuggestedPromptsServices(store)
      }
    />
  ),
};

const actions: TuiTool['actions'] = {
  [McpScreenId.Add]: [setMcpOutcome('Complete the standalone MCP-add flow.')],
  [McpScreenId.Remove]: [
    setMcpOutcome('Complete the standalone MCP-remove flow.'),
  ],
  [McpScreenId.SuggestedPrompts]: [
    {
      id: 'dismiss',
      description: 'Dismiss the suggested-prompts step.',
      apply: (store) => setMcpSuggestedPromptsDismissed(store),
    },
  ],
};

const setters: TuiTool['setters'] = [
  {
    name: 'setMcpSuggestedPromptsDismissed',
    description: 'Dismiss the suggested-prompts step.',
    apply: (store) => setMcpSuggestedPromptsDismissed(store),
  },
];

const shared = { screens, actions, setters };

export const TUI_TOOLS: TuiTools = {
  'mcp-add': { flow: MCP_ADD_FLOW, ...shared },
  'mcp-remove': { flow: MCP_REMOVE_FLOW, ...shared },
  'mcp-tutorial': { flow: MCP_TUTORIAL_FLOW, ...shared },
};
