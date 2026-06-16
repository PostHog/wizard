/**
 * exit-line.ts — builds the text printed to the MAIN terminal buffer after the
 * wizard leaves the alternate screen on exit.
 *
 * The TUI renders in the alternate screen buffer, which is torn down on exit —
 * everything the wizard drew (including the outro screen) is wiped. This line,
 * printed AFTER releaseTerminal(), is the only output that survives into the
 * user's scrollback. So the coding-agent handoff prompt is echoed here, on its
 * own plain line (no border, no bullets), which is what a terminal can
 * triple-click-select cleanly.
 *
 * Kept free of `ink`/`@inkjs/ui` imports so it stays a pure, unit-testable
 * function (start-tui.ts itself pulls in the whole render tree).
 */

import type { WizardStore } from './store.js';
import { OutroKind } from '@lib/wizard-session';
import { getProgramConfig } from '@lib/programs/program-registry';

const RESET_ATTRS = '\x1b[0m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/**
 * Interim "recommended next" block — the picks made on the RecommendedNext
 * screen, rendered as copy-paste `npx` commands. This is the throwaway
 * consumer of `session.recommendedFollowUps`; a future orchestrator/queue
 * will run these in-process instead. Returns '' when nothing was picked.
 */
function getFollowUpBlock(store: WizardStore): string {
  const commands = store.session.recommendedFollowUps
    .map((id) => getProgramConfig(id).command)
    .filter((command): command is string => command != null)
    .map((command) => `  npx @posthog/wizard ${command}`);

  if (commands.length === 0) return '';

  return (
    `\n\n${DIM}Recommended next — run these to set up more:${RESET_ATTRS}\n` +
    commands.join('\n')
  );
}

export function getExitLine(store: WizardStore): string {
  const outro = store.session.outroData;
  const label = store.session.programLabel ?? 'Wizard';

  if (outro?.kind === OutroKind.Success) {
    const message = outro.message ?? `${label} completed successfully.`;
    const reportSuffix =
      outro.reportFile && !message.includes(outro.reportFile)
        ? ` Check ./${outro.reportFile} for details.`
        : '';
    const headline = `${GREEN}${BOLD}✔${RESET_ATTRS} ${message}${reportSuffix}`;
    const followUps = getFollowUpBlock(store);

    if (outro.handoffPrompt) {
      return (
        `${headline}\n\n` +
        `${DIM}Hand this to your coding agent to finish up (triple-click to select):${RESET_ATTRS}\n` +
        outro.handoffPrompt +
        followUps
      );
    }
    return headline + followUps;
  }

  return `${DIM}${label} exited.${RESET_ATTRS}`;
}
