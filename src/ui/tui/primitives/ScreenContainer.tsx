/**
 * ScreenContainer — Renders TitleBar + routes between screens with transitions.
 * Takes a screens map and renders the one matching store.currentScreen.
 * Horizontal wipe plays on push (left) or pop (right).
 *
 * Each screen is wrapped in a ScreenErrorBoundary so that render crashes
 * route to the outro screen with an error message instead of hanging.
 */

import { Box, useStdout } from 'ink';
import { useSyncExternalStore, type ReactNode } from 'react';
import { TitleBar } from '../components/TitleBar.js';
import { DissolveTransition } from './DissolveTransition.js';
import { ScreenErrorBoundary } from './ScreenErrorBoundary.js';
import type { WizardStore } from '../store.js';

const MIN_WIDTH = 80;
const MAX_WIDTH = 120;

interface ScreenContainerProps {
  store: WizardStore;
  screens: Record<string, ReactNode>;
}

export const ScreenContainer = ({ store, screens }: ScreenContainerProps) => {
  const { stdout } = useStdout();
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, stdout.columns));
  const contentHeight = Math.max(5, stdout.rows - 3);
  const contentWidth = Math.max(10, width - 2);
  const direction = store.lastNavDirection === 'pop' ? 'right' : 'left';
  const activeScreen = screens[store.currentScreen] ?? null;

  return (
    <Box flexDirection="column" height={stdout.rows} width={width}>
      <TitleBar version={store.version} />
      <Box height={1} />
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <DissolveTransition
          transitionKey={store.currentScreen}
          width={contentWidth}
          height={contentHeight}
          direction={direction}
        >
          <ScreenErrorBoundary store={store}>
            {activeScreen}
          </ScreenErrorBoundary>
        </DissolveTransition>
      </Box>
    </Box>
  );
};
