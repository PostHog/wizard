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

import { isAbsolute, join } from 'node:path';
import { totalTokenCount, type WizardStore } from './store.js';
import { OutroKind } from '@lib/wizard-session';
import { formatTokenCount, formatCostUsd } from '@lib/agent/token-pricing';

const RESET_ATTRS = '\x1b[0m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/**
 * Mirrors the hidden Ctrl+T HUD's tally into post-exit scrollback — but only
 * when the HUD is actually visible at exit (`store.tokenHudVisible`, which
 * defaults on in dev/test and off in production; `useDismissOnAnyKey`
 * already keeps Ctrl+T from also dismissing the outro screen underneath
 * it). A production run where the user never toggled it on shouldn't have a
 * cost number appear from nowhere once the TUI tears down. `null` when the
 * HUD is hidden, or the run never produced any usage (e.g. non-agent
 * programs).
 */
function tokenCostLine(store: WizardStore): string | null {
  if (!store.tokenHudVisible) return null;
  const usage = store.tokenUsage;
  if (totalTokenCount(usage) === 0) return null;

  const label = usage.costIsFinal ? 'Final cost' : 'Cost (estimate)';
  return (
    `${DIM}${label}: ${formatCostUsd(usage.costUsd)}` +
    ` (in ${formatTokenCount(usage.inputTokens)}` +
    ` · out ${formatTokenCount(usage.outputTokens)}` +
    ` · cache read ${formatTokenCount(usage.cacheReadTokens)}` +
    ` · cache write ${formatTokenCount(
      usage.cacheCreationTokens,
    )})${RESET_ATTRS}`
  );
}

export function getExitLine(store: WizardStore): string {
  const outro = store.session.outroData;
  const label = store.session.programLabel ?? 'Wizard';
  const costLine = tokenCostLine(store);

  if (outro?.kind === OutroKind.Success) {
    const message = outro.message ?? `${label} completed successfully.`;
    // `reportFile` reaching here means the file was verified on disk by the
    // runner (see linear.ts / orchestrator-runner.ts), so we can promise it
    // without over-claiming. Surface the resolved path — a bare `./` is wrong
    // when the user passed --install-dir and ran from elsewhere. The
    // orchestrator's queue-file fallback is already absolute, so only join
    // relative report names against installDir.
    const reportPath = outro.reportFile
      ? isAbsolute(outro.reportFile)
        ? outro.reportFile
        : join(store.session.installDir, outro.reportFile)
      : undefined;
    const reportSuffix =
      reportPath && outro.reportFile && !message.includes(outro.reportFile)
        ? ` Check ${reportPath} for details.`
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

    if (costLine) parts.push(costLine);

    return parts.join('\n\n');
  }

  return costLine
    ? `${DIM}${label} exited.${RESET_ATTRS}\n\n${costLine}`
    : `${DIM}${label} exited.${RESET_ATTRS}`;
}
