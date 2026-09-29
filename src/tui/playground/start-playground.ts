/**
 * start-playground.ts — Launches the TUI primitives playground.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { Program } from '@programs';
import { WizardStore } from '@tui/store';
import { PlaygroundApp } from './PlaygroundApp.js';
import { HostResolution } from '@shared/host-resolution';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { enterDarkTerminal, releaseTerminal } from '../terminal.js';

/** Launch the playground. Resolves 0 once it closes (Ink exits or a screen asks to end) and the terminal is restored. */
export function startPlayground(version: string): Promise<number> {
  enterDarkTerminal();

  const store = new WizardStore(Program.PostHogIntegration);
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

  return new Promise((resolve) => {
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      unmount();
      releaseTerminal();
      resolve(0);
    };
    store.subscribe(() => {
      if (store.exitRequest !== null) close();
    });
    void waitUntilExit().then(close);
  });
}
