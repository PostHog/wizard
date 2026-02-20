/**
 * Detects workflow phase transitions from SDK messages.
 *
 * Only triggers on tool_use file reads (file_path / path) that reference
 * a workflow file like "1.1-edit.md". Text mentions are ignored because
 * the agent references all phases during planning in 1.0-begin.
 */

/** Matches "1.0-begin" from file paths */
const WORKFLOW_FILE_RE = /(\d+\.\d+-[a-z]+)(?:\.md)?/;

export class PhaseDetector {
  private seenPhases = new Set<string>();

  /**
   * Inspect an SDK message and return a new phase name if a transition
   * is detected, or null if no transition occurred.
   */
  detect(message: any): string | null {
    if (message.type !== 'assistant') return null;

    const content = message.message?.content;
    if (!Array.isArray(content)) return null;

    for (const block of content) {
      // Only detect from tool_use file reads — text mentions fire too early
      if (block.type === 'tool_use') {
        const filePath = block.input?.file_path ?? block.input?.path ?? '';
        if (typeof filePath === 'string') {
          const match = filePath.match(WORKFLOW_FILE_RE);
          if (match && !this.seenPhases.has(match[1])) {
            this.seenPhases.add(match[1]);
            return match[1];
          }
        }
      }
    }
    return null;
  }

  reset(): void {
    this.seenPhases.clear();
  }
}
