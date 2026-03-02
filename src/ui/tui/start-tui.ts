/**
 * start-tui.ts — Sets up the Ink TUI renderer and InkUI.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore, type CloudRegion, Flow } from './store.js';
import { InkUI } from './ink-ui.js';
import { setUI } from '../index.js';
import { App } from './App.js';

// ANSI: set default background to black, clear screen with that background
const FORCE_DARK = '\x1b[48;2;0;0;0m\x1b[2J\x1b[H';
// ANSI: reset all attributes
const RESET = '\x1b[0m';

export function startTUI(
  version: string,
  flow: Flow = Flow.Wizard,
): {
  unmount: () => void;
  store: WizardStore;
  waitForSetup: () => Promise<CloudRegion>;
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
    process.stdout.write(RESET + '\x1b[2J\x1b[H');
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
