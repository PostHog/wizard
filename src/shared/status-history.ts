/** Shared FIFO window for agent snapshots and the terminal status panel. */
export const MAX_STATUS_MESSAGES = 10;

export function appendStatus(messages: string[], message: string): string[] {
  if (messages.length > 0 && messages[messages.length - 1] === message) {
    return messages;
  }
  return [...messages.slice(-(MAX_STATUS_MESSAGES - 1)), message];
}
