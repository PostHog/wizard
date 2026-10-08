/**
 * start-tui.ts — Sets up the Ink TUI renderer over a new store.
 *
 * Renders in the terminal's alternate screen buffer so the wizard
 * doesn't pollute scrollback history. On exit, the previous terminal
 * content is restored and a single exit summary line is printed.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore, type ProgramId } from './store.js';
import { App } from './App.js';
import { enterDarkTerminal, releaseTerminal } from './terminal.js';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { getExitLine } from './exit-line.js';
import { ErrorCodes, WizardError } from '@shared/errors';

export { releaseTerminal };

/** Render the app for `program`. `onInterrupt` runs when Ink tears itself down on Ctrl+C; the caller ends the run. */
export function startTUI(
  version: string,
  program: ProgramId,
  onInterrupt: () => void,
): {
  unmount: () => void;
  store: WizardStore;
  waitForSetup: () => Promise<void>;
} {
  // Ink needs raw mode on stdin and otherwise fails later as an unhandled rejection.
  if (!process.stdin.isTTY) {
    throw new WizardError(
      'This command needs an interactive terminal (stdin is not a TTY). Run the wizard directly in a terminal, not through a pipe or script.',
      undefined,
      ErrorCodes.CliInteractiveRequired,
    );
  }

  enterDarkTerminal();

  const store = new WizardStore(program);
  store.version = version;

  const { unmount: inkUnmount, waitUntilExit } = render(
    createElement(App, { store }),
  );

  analytics.setTag('program_id', program);
  // The launch marker — the first event of every TUI run, captured under
  // the run's anonymous id and merged into the user once they log in.
  analytics.wizardCapture('started', { program_id: program });

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
  // end the process: background handles (e.g. the OAuth callback server)
  // keep the event loop alive. `cleaned` still false means Ink tore itself
  // down rather than the host, so the caller ends the run.
  void waitUntilExit().then(() => {
    if (!cleaned) onInterrupt();
  });

  return {
    unmount: cleanup,
    store,
    waitForSetup: () => store.getGate('intro'),
  };
}
