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
import { enterDarkTerminal, releaseTerminal } from './terminal.js';

export { releaseTerminal };

const RESET_ATTRS = '\x1b[0m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

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
  enterDarkTerminal();

  const store = new WizardStore(program);
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
    releaseTerminal();
    process.stdout.write(getExitLine(store) + '\n');
  };
  process.on('exit', cleanup);

  return {
    unmount: cleanup,
    store,
    waitForSetup: () => store.getGate('intro'),
  };
}
