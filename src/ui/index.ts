/**
 * UI singleton — provides getUI() and setUI() for the wizard.
 * Default: LoggingUI. Swap to InkUI at startup for TUI mode.
 */

import type { WizardUI } from './wizard-ui';
import { LoggingUI } from './logging-ui';
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

export type { WizardUI, SpinnerHandle } from './wizard-ui';
