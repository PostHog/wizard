/**
 * Screen registry — declarative screen definitions for the TUI.
 */

import type { FunctionComponent } from 'react';
import type { WizardStore, ScreenName } from '../store.js';

export interface ScreenConfig {
  id: ScreenName;
  component: FunctionComponent<{ store: WizardStore }>;
}

const registry: ScreenConfig[] = [];

export function registerScreen(config: ScreenConfig): void {
  if (!registry.find((s) => s.id === config.id)) {
    registry.push(config);
  }
}

export function getScreenComponent(
  id: ScreenName,
): FunctionComponent<{ store: WizardStore }> | undefined {
  return registry.find((s) => s.id === id)?.component;
}

export function getScreens(): ScreenConfig[] {
  return registry;
}
