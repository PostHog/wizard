/**
 * The CLI's current UI: LoggingUI until an entry point swaps in the TUI's
 * InkUI (or HeadlessUI). Only CLI code looks it up; every other layer takes
 * the host it needs as an argument.
 */

import type { WizardUI } from './wizard-ui';
import { LoggingUI } from '@headless/renderers/logging-ui';
import { setDebugSink } from '@utils/debug';

let currentUI: WizardUI = new LoggingUI();

// Shared code never looks the UI up; `debug()` reports through whichever UI
// is current, installed here so the sink follows setUI().
setDebugSink((line) => currentUI.log.info(line));

export function getUI(): WizardUI {
  return currentUI;
}

export function setUI(ui: WizardUI): void {
  currentUI = ui;
}

export type { WizardUI } from './wizard-ui';
