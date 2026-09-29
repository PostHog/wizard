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

import { totalTokenCount, type WizardStore } from './store.js';
import { OutroKind } from '@lib/wizard-session';
import { isRunFailure, MINT_FAILURE_CONTACT } from '@ui/mint-failure';
import { formatTokenCount, formatCostUsd } from '@shared/token-pricing';
import { getLogFilePath } from '@utils/debug';
import { readFileHead } from '@utils/bounded-fs';
import {
  NEEDS_ATTENTION_HEADING,
  readNeedsAttention,
} from '@utils/needs-attention';
import { join } from 'path';

const RESET_ATTRS = '\x1b[0m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const REPORT_HEAD_BYTES = 16 * 1024;

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

/**
 * The one manual step the wizard can't do itself: the editor's own MCP login.
 * Echoed into scrollback like the handoff prompt — command on its own plain
 * line so a terminal can triple-click-select it.
 */
function mcpLoginBlock(store: WizardStore): string | null {
  const commands = store.session.mcpLoginCommands;
  if (!commands || commands.length === 0) return null;
  return (
    `${GREEN}${BOLD}\u2714 Authenticate to finish (opens your browser):${RESET_ATTRS}\n` +
    commands.join('\n')
  );
}

/** The report's warning items, from the published handoff or else the report file. */
function needsAttentionBlock(store: WizardStore): string | null {
  const reportFile = store.session.outroData?.reportFile;
  const markdown =
    store.handoffText ??
    (reportFile
      ? readFileHead(
          join(store.session.installDir, reportFile),
          REPORT_HEAD_BYTES,
        )
      : null);
  const items = markdown ? readNeedsAttention(markdown) : [];
  if (items.length === 0) return null;
  return (
    `${YELLOW}${BOLD}⚠ ${NEEDS_ATTENTION_HEADING}:${RESET_ATTRS}\n` +
    items.map((item) => `  • ${item}`).join('\n')
  );
}

export function getExitLine(store: WizardStore): string {
  const attention = needsAttentionBlock(store);
  const body = exitSummary(store);
  return attention ? `${attention}\n\n${body}` : body;
}

function exitSummary(store: WizardStore): string {
  const outro = store.session.outroData;
  const label = store.session.programLabel ?? 'Wizard';
  const costLine = tokenCostLine(store);
  const loginBlock = mcpLoginBlock(store);

  if (isRunFailure(store.session)) {
    const spellbook = store.session.spellbook;
    return [
      'The wizard is unavailable. Setup has not been completed.',
      spellbook &&
        `${DIM}Point your agent at this skill (triple-click to select):${RESET_ATTRS}\n${spellbook.path}`,
      `${DIM}${MINT_FAILURE_CONTACT}${RESET_ATTRS}\n${getLogFilePath()}`,
      loginBlock,
      costLine,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

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

    if (loginBlock) parts.push(loginBlock);
    if (costLine) parts.push(costLine);

    return parts.join('\n\n');
  }

  const parts = loginBlock
    ? [loginBlock]
    : [`${DIM}${label} exited.${RESET_ATTRS}`];
  if (costLine) parts.push(costLine);
  return parts.join('\n\n');
}
