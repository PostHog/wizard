/**
 * UI singleton — provides getUI() and setUI() for the wizard.
 * Default: LoggingUI. Swap to InkUI at startup for TUI mode.
 */

import type { WizardUI } from './wizard-ui';
import { LoggingUI } from './logging-ui';

let currentUI: WizardUI = new LoggingUI();

export function getUI(): WizardUI {
  return currentUI;
}

export function setUI(ui: WizardUI): void {
  currentUI = ui;
}

export type { WizardUI, SpinnerHandle } from './wizard-ui';
