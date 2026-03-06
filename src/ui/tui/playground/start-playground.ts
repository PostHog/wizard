/**
 * start-playground.ts — Launches the TUI primitives playground.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore } from '../store.js';
import { PlaygroundApp } from './PlaygroundApp.js';

export function startPlayground(version: string): void {
  const store = new WizardStore();
  store.version = version;

  const { unmount, waitUntilExit } = render(
    createElement(PlaygroundApp, { store }),
  );

  void waitUntilExit().then(() => {
    unmount();
    process.exit(0);
  });
}
