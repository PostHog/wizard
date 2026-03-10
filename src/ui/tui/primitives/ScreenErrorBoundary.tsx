/**
 * ScreenErrorBoundary — catches React render errors in screens
 * and routes to the outro screen with an error message.
 *
 * Without this, a screen crash silently hangs the TUI.
 */

import { Box, Text } from 'ink';
import { Component, type ReactNode } from 'react';
import type { WizardStore } from '../store.js';
import { OutroKind, RunPhase } from '../../../lib/wizard-session.js';

interface Props {
  store: WizardStore;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    const { store } = this.props;

    // eslint-disable-next-line no-console
    console.error('[ScreenErrorBoundary]', error.message, error.stack);

    // Set error state — the router will resolve to outro
    store.setOutroData({
      kind: OutroKind.Error,
      message: `A screen crashed: ${error.message}`,
    });
    store.setRunPhase(RunPhase.Error);
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
