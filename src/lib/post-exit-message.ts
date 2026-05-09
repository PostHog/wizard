/**
 * Stash text to print to the user's scrollback after the wizard exits.
 * Read by `start-tui.ts`'s cleanup handler, AFTER `releaseTerminal()` —
 * so the message survives any exit path (bin.ts unmount, screens that
 * call `process.exit` directly, error paths).
 *
 * Why frameworkContext (not session.outroData):
 *   `agent-runner.ts` mutates `session.outroData` on a STALE session
 *   reference — by the time the mutation happens, `setKey` calls during
 *   the agent run have replaced the atom's top-level session, so the
 *   write goes to a stranded object. `frameworkContext` is the same
 *   reference across `setKey` shallow-spreads, so a direct mutation on
 *   it survives (until anyone calls `store.setFrameworkContext`, which
 *   clones it). Same pattern as
 *   `posthog-integration/handoff.ts`'s handoff-status accessor.
 */

import type { WizardSession } from './wizard-session.js';

export const POST_EXIT_MESSAGE_KEY = 'pendingPostExitMessage';

export function setPostExitMessage(
  session: WizardSession,
  message: string,
): void {
  session.frameworkContext[POST_EXIT_MESSAGE_KEY] = message;
}

export function getPostExitMessage(session: WizardSession): string | undefined {
  const v = session.frameworkContext?.[POST_EXIT_MESSAGE_KEY];
  return typeof v === 'string' ? v : undefined;
}
