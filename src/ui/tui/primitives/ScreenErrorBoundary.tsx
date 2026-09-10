/**
 * ScreenErrorBoundary — catches React render errors in screens
 * and routes to the outro screen with an error message.
 *
 * Without this, a screen crash silently hangs the TUI.
 */

import { Box, Text } from 'ink';
import { Component, type ReactNode } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { OutroKind, RunPhase } from '@lib/wizard-session';
import { logToFile } from '@utils/debug';

interface Props {
  store: WizardStore;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Route a crashed screen to the outro.
 *
 * The ask overlay is a screen like any other, so a render throw can land while
 * a `wizard_ask` request is in flight. Release it first: the agent is parked on
 * that promise, and the store rejects the next `wizard_ask` while one is still
 * pending, so a crash that leaves it set wedges the rest of the run. Cancelling
 * hands the agent the same sentinel as an Esc, which every task already treats
 * as "the user declined" and falls back on. No-op when nothing is pending.
 *
 * Extracted from the boundary so it is testable without a live Ink render.
 */
export function handleScreenCrash(store: WizardStore, error: Error): void {
  store.cancelPendingQuestion();
  store.setOutroData({
    kind: OutroKind.Error,
    message: `A screen crashed: ${error.message}`,
  });
  store.setRunPhase(RunPhase.Error);
}

export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // The console.error below is wiped with the alt screen; this survives.
    logToFile('[screen-error-boundary]', error);
    // eslint-disable-next-line no-console
    console.error('[ScreenErrorBoundary]', error.message, error.stack);

    handleScreenCrash(this.props.store, error);
  }

  render(): ReactNode {
    if (this.state.error) {
      // Fallback while the store transition fires
      return (
        <Box flexDirection="column">
          <Text color="red" bold>
            Something went wrong.
          </Text>
          <Text dimColor>{this.state.error.message}</Text>
        </Box>
      );
    }

    return this.props.children;
  }
}
