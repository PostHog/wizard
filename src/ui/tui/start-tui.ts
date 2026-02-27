/**
 * start-tui.ts — Sets up the Ink TUI renderer and InkUI.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore, type CloudRegion } from './store.js';
import { InkUI } from './ink-ui.js';
import { setUI } from '../index.js';
import { App } from './App.js';

export function startTUI(version: string): {
  unmount: () => void;
  store: WizardStore;
  waitForSetup: () => Promise<CloudRegion>;
} {
  const store = new WizardStore();
  store.version = version;

  // Swap in the InkUI
  const inkUI = new InkUI(store);
  setUI(inkUI);

  // Render the Ink app
  const { unmount } = render(createElement(App, { store }));

  return {
    unmount,
    store,
    waitForSetup: () => store.setupComplete,
  };
}
