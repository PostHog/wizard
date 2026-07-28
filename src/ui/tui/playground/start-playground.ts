/**
 * start-playground.ts — Launches the TUI primitives playground.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore } from '@ui/tui/store';
import { PlaygroundApp } from './PlaygroundApp.js';
import { HostResolution } from '@lib/host-resolution';
import { WizardReadiness } from '@lib/health-checks/readiness';
import { enterDarkTerminal, releaseTerminal } from '../terminal.js';

export function startPlayground(version: string): void {
  enterDarkTerminal();

  const store = new WizardStore();
  store.version = version;

  // Pre-fill session so the router skips health-check, auth, and setup,
  // landing on 'run' after the intro screen.
  // dismissOutage() guards against the onInit health-check async result
  // overwriting this with WizardReadiness.No before the user presses enter.
  store.setReadinessResult({
    decision: WizardReadiness.Yes,
    health: {} as never,
    reasons: [],
  });
  store.dismissOutage();
  store.setCredentials({
    accessToken: 'fake',
    projectApiKey: 'fake',
    host: HostResolution.fromApiHost('https://app.posthog.com'),
    projectId: 0,
  });

  const { unmount, waitUntilExit } = render(
    createElement(PlaygroundApp, { store }),
  );

  void waitUntilExit().then(() => {
    unmount();
    releaseTerminal();
    process.exit(0);
  });
}
