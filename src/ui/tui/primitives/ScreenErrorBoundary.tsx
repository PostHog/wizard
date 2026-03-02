/**
 * ScreenErrorBoundary — catches React render errors in screens
 * and routes to the outro screen with an error message.
 *
 * Without this, a screen crash silently hangs the TUI.
 */

import { Box, Text } from 'ink';
import { Component, type ReactNode } from 'react';
import type { WizardStore } from '../store.js';

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

    // Push an error outro so the user sees what happened
    store.setOutroData({
      kind: 'error',
      message: `A screen crashed: ${error.message}`,
    });
    store.jumpTo('outro');
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
