// UI singleton. The default renders nothing; hosts install their own renderer.

import type { WizardUI } from './wizard-ui';
import { NullUI } from './null-ui';

let currentUI: WizardUI = new NullUI();

export function getUI(): WizardUI {
  return currentUI;
}

export function setUI(ui: WizardUI): void {
  currentUI = ui;
}

export type { WizardUI, SpinnerHandle } from './wizard-ui';
