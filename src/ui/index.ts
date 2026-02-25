/**
 * UI singleton — provides getUI() and setUI() for the wizard.
 * Default: ConsoleUI. Swap to InkUI at startup for TUI mode.
 */

import type { WizardUI } from './wizard-ui';
import { ConsoleUI } from './console-ui';

let currentUI: WizardUI = new ConsoleUI();

export function getUI(): WizardUI {
  return currentUI;
}

export function setUI(ui: WizardUI): void {
  currentUI = ui;
}

export type { WizardUI, SpinnerHandle, SelectOption } from './wizard-ui';
