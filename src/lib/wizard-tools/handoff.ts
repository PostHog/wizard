/**
 * publish_handoff — the agent publishes the run's handoff doc (the report
 * markdown) in one explicit call, replacing the report file + watcher path.
 */

import { getUI } from '@ui';
import { analytics } from '@utils/analytics';

// Cap matching the backend serializer (MAX_HANDOFF_TEXT_LENGTH); an oversized push would 400.
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

export function publishHandoff(content: string): PublishHandoffResult {
  if (content.trim() === '') {
    analytics.wizardCapture('handoff published', {
      handoff_ok: false,
      handoff_reject_reason: 'blank_content',
    });
    return {
      ok: false,
      message:
        'Error: `content` must be the complete report markdown (a non-empty string).',
    };
  }
  const truncated = content.length > MAX_HANDOFF_TEXT_CHARS;
  const text = truncated ? content.slice(0, MAX_HANDOFF_TEXT_CHARS) : content;
  getUI().setHandoffText(text);
  // Size and truncation only — never the report itself, which quotes the user's code.
  analytics.wizardCapture('handoff published', {
    handoff_ok: true,
    handoff_chars: text.length,
    handoff_truncated: truncated,
  });
  return {
    ok: true,
    message: `Handoff published (${text.length} chars${
      truncated ? ', truncated to the 64 KB limit' : ''
    }).`,
  };
}
