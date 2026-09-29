/** The MCP tools' screen answers, written through the store's generic setter. */
import type { WizardStore } from '@tui/store';

/** The suggested-prompts step (the MCP tutorial) is done. */
export function setMcpSuggestedPromptsDismissed(store: WizardStore): void {
  store.updateTuiState({ mcpSuggestedPromptsDismissed: true });
}
