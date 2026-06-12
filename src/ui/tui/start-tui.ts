/**
 * start-tui.ts — Sets up the Ink TUI renderer and InkUI.
 *
 * Renders in the terminal's alternate screen buffer so the wizard
 * doesn't pollute scrollback history. On exit, the previous terminal
 * content is restored and a single exit summary line is printed.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore, Program, type ProgramId } from './store.js';
import { InkUI } from './ink-ui.js';
import { setUI } from '@ui/index';
import { App } from './App.js';
import { OutroKind } from '@lib/wizard-session';
import { logToFile } from '@utils/debug';

// ANSI escape sequences
const RESET_ATTRS = '\x1b[0m';
const CLEAR_SCREEN = '\x1b[2J';
const CURSOR_HOME = '\x1b[H';
const BG_BLACK = '\x1b[48;2;0;0;0m';
const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

export function releaseTerminal(): void {
  process.stdout.write(RESET_ATTRS + LEAVE_ALT_SCREEN);
}

function getExitLine(store: WizardStore): string {
  const outro = store.session.outroData;
  const label = store.session.programLabel ?? 'Wizard';

  if (outro?.kind === OutroKind.Success) {
    const message = outro.message ?? `${label} completed successfully.`;
    const reportSuffix =
      outro.reportFile && !message.includes(outro.reportFile)
        ? ` Check ./${outro.reportFile} for details.`
        : '';
    return `${GREEN}${BOLD}\u2714${RESET_ATTRS} ${message}${reportSuffix}`;
  }

  return `${DIM}${label} exited.${RESET_ATTRS}`;
}

export function startTUI(
  version: string,
  program: ProgramId = Program.PostHogIntegration,
): {
  unmount: () => void;
  store: WizardStore;
  waitForSetup: () => Promise<void>;
} {
  // Enter alternate screen buffer, then set up dark background
  process.stdout.write(
    ENTER_ALT_SCREEN + BG_BLACK + CLEAR_SCREEN + CURSOR_HOME,
  );

  const store = new WizardStore(program);
  store.version = version;

  const inkUI = new InkUI(store);
  setUI(inkUI);

  const { unmount: inkUnmount, waitUntilExit } = render(
    createElement(App, { store }),
  );

  // Fire the program steps' init work (e.g. the health-check pre-flight)
  // now that the screens are rendering — store construction alone must
  // not trigger it.
  store.runInitHooks();

  // Tearing down raw mode with a TTY read still pending surfaces a
  // benign 'read EIO' on stdin (macOS); without a handler Node treats
  // it as an uncaught exception and prints a stack over the exit line.
  process.stdin.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EIO') throw err;
  });

  // On exit: unmount Ink, leave alt screen (restores previous content),
  // then print exit summary line into the main buffer.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    // Timestamp the teardown — everything printed into the alt screen dies here.
    logToFile(
      `[start-tui] unmounting TUI, leaving alt screen (exitCode=${
        process.exitCode ?? 'unset'
      })`,
    );
    inkUnmount();
    releaseTerminal();
    process.stdout.write(getExitLine(store) + '\n');
  };
  process.on('exit', cleanup);

  // Ink unmounts itself on ctrl+c (exitOnCtrlC) but that alone doesn't
  // end the process — background handles (e.g. the OAuth callback
  // server) keep the event loop alive, leaving a zombie wizard with no
  // UI. Follow the app teardown with a real exit.
  void waitUntilExit().then(() => {
    cleanup();
    process.exit(process.exitCode ?? 0);
  });

  return {
    unmount: cleanup,
    store,
    waitForSetup: () => store.getGate('intro'),
  };
}
