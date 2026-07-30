/**
 * publish_handoff — the run's handoff doc as one explicit tool call.
 *
 * The agent calls this once, at the end of the run, with the complete report
 * markdown. The content lands on the store via `getUI().setHandoffText(...)`,
 * from where the task-stream push publishes it to the wizard session as
 * `handoff_text`. This replaces the passive path (the agent writing a report
 * file and a watcher mirroring it into the store): no report file is written
 * to the user's project at all.
 */

import { getUI } from '@ui';

// Character cap matching the backend serializer (MAX_HANDOFF_TEXT_LENGTH):
// an oversized push would 400 and, because the payload is a full-state
// snapshot, take every later session update down with it.
export const MAX_HANDOFF_TEXT_CHARS = 64 * 1024;

export const PUBLISH_HANDOFF_TOOL_NAME = 'publish_handoff';

/** Shared between the MCP server and the pi facade so the contract can't drift. */
export const PUBLISH_HANDOFF_DESCRIPTION =
  'Publish the handoff document — the full markdown report of what this run did — to the wizard session. ' +
  'Call it exactly once, at the end of the run, passing the complete report as `content`. ' +
  'This call is the only way the report reaches the user; do not write the report to a file instead.';

export const PUBLISH_HANDOFF_CONTENT_DESCRIPTION =
  'The complete handoff report as markdown, starting with an H1 heading.';

export interface PublishHandoffResult {
  ok: boolean;
  message: string;
}

export function publishHandoff(content: unknown): PublishHandoffResult {
  if (typeof content !== 'string' || content.trim() === '') {
    return {
      ok: false,
      message:
        'Error: `content` must be the complete report markdown (a non-empty string).',
    };
  }
  const truncated = content.length > MAX_HANDOFF_TEXT_CHARS;
  const text = truncated ? content.slice(0, MAX_HANDOFF_TEXT_CHARS) : content;
  getUI().setHandoffText(text);
  return {
    ok: true,
    message: `Handoff published (${text.length} chars${
      truncated ? ', truncated to the 64 KB limit' : ''
    }).`,
  };
}
