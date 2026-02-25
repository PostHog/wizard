/**
 * Tab registry — declarative tab definitions for the TUI.
 */

import type { FunctionComponent } from 'react';
import type { WizardStore } from '../store.js';

export interface TabConfig {
  id: string;
  label: string;
  component: FunctionComponent<{ store: WizardStore }>;
}

const registry: TabConfig[] = [];

export function registerTab(config: TabConfig): void {
  // Avoid duplicates
  if (!registry.find((t) => t.id === config.id)) {
    registry.push(config);
  }
}

export function getTabs(): TabConfig[] {
  return registry;
}

export function getTabComponent(
  id: string,
): FunctionComponent<{ store: WizardStore }> | undefined {
  return registry.find((t) => t.id === id)?.component;
}
