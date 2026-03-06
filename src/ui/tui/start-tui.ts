/**
 * start-tui.ts — Sets up the Ink TUI renderer and InkUI.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore, Flow } from './store.js';
import { InkUI } from './ink-ui.js';
import { setUI } from '../index.js';
import { App } from './App.js';

// ANSI escape sequences
const RESET_ATTRS = '\x1b[0m';
const CLEAR_SCREEN = '\x1b[2J';
const CURSOR_HOME = '\x1b[H';
const BG_BLACK = '\x1b[48;2;0;0;0m';

/** Set background to true black, clear screen, cursor to top-left. */
const FORCE_DARK = BG_BLACK + CLEAR_SCREEN + CURSOR_HOME;

export function startTUI(
  version: string,
  flow: Flow = Flow.Wizard,
): {
  unmount: () => void;
  store: WizardStore;
  waitForSetup: () => Promise<void>;
} {
  // Force dark background regardless of terminal theme
  process.stdout.write(FORCE_DARK);

  const store = new WizardStore(flow);
  store.version = version;

  // Swap in the InkUI
  const inkUI = new InkUI(store);
  setUI(inkUI);

  // Render the Ink app
  const { unmount: inkUnmount } = render(createElement(App, { store }));

  // Reset terminal on exit
  const cleanup = () => {
    process.stdout.write(RESET_ATTRS + CLEAR_SCREEN + CURSOR_HOME);
  };
  process.on('exit', cleanup);

  return {
    unmount: () => {
      inkUnmount();
      cleanup();
    },
    store,
    waitForSetup: () => store.setupComplete,
  };
}
