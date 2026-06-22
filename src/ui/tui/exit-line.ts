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

const RESET_ATTRS = '\x1b[0m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

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

    const parts = [headline];

    // The alt-screen outro is wiped on exit, so a program's primary
    // next-action link (e.g. the Self-driving inbox) only survives in
    // scrollback if echoed here. URL on its own line → clean triple-click.
    if (outro.primaryLink) {
      parts.push(
        `${DIM}${outro.primaryLink.label}:${RESET_ATTRS}\n${outro.primaryLink.url}`,
      );
    }

    if (outro.nextSteps) {
      const bullets = outro.nextSteps.items
        .map((item) => `${DIM}  • ${item}${RESET_ATTRS}`)
        .join('\n');
      parts.push(`${DIM}${outro.nextSteps.heading}${RESET_ATTRS}\n${bullets}`);
    }

    if (outro.handoffPrompt) {
      parts.push(
        `${DIM}Hand this to your coding agent to finish up (triple-click to select):${RESET_ATTRS}\n` +
          outro.handoffPrompt,
      );
    }

    return parts.join('\n\n');
  }

  return `${DIM}${label} exited.${RESET_ATTRS}`;
}
