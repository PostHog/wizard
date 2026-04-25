/**
 * start-tui.ts — Sets up the Ink TUI renderer and InkUI.
 *
 * Renders in the terminal's alternate screen buffer so the wizard
 * doesn't pollute scrollback history. On exit, the previous terminal
 * content is restored and a single exit summary line is printed.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore, Flow } from './store.js';
import { InkUI } from './ink-ui.js';
import { setUI } from '../index.js';
import { App } from './App.js';
import { OutroKind } from '../../lib/wizard-session.js';

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

function getExitLine(store: WizardStore): string {
  const outro = store.session.outroData;
  const label = store.session.workflowLabel ?? 'Wizard';

  if (outro?.kind === OutroKind.Success) {
    return `${GREEN}${BOLD}\u2714${RESET_ATTRS} ${
      outro.message ?? `${label} completed successfully.`
    }`;
  }

  return `${DIM}${label} exited.${RESET_ATTRS}`;
}

export function startTUI(
  version: string,
  flow: Flow = Flow.PostHogIntegration,
): {
  unmount: () => void;
  store: WizardStore;
  waitForSetup: () => Promise<void>;
} {
  // Enter alternate screen buffer, then set up dark background
  process.stdout.write(
    ENTER_ALT_SCREEN + BG_BLACK + CLEAR_SCREEN + CURSOR_HOME,
  );

  const store = new WizardStore(flow);
  store.version = version;

  const inkUI = new InkUI(store);
  setUI(inkUI);

  const { unmount: inkUnmount } = render(createElement(App, { store }));

  // On exit: unmount Ink, leave alt screen (restores previous content),
  // then print exit summary line into the main buffer.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    inkUnmount();
    process.stdout.write(RESET_ATTRS + LEAVE_ALT_SCREEN);
    process.stdout.write(getExitLine(store) + '\n');
  };
  process.on('exit', cleanup);

  return {
    unmount: cleanup,
    store,
    waitForSetup: () => store.getGate('intro'),
  };
}
