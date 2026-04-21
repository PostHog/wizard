/**
 * ScreenContainer — Renders TitleBar + routes between screens with transitions.
 * Takes a screens map and renders the one matching store.currentScreen.
 * Horizontal wipe plays on push (left) or pop (right).
 *
 * Each screen is wrapped in a ScreenErrorBoundary so that render crashes
 * route to the outro screen with an error message instead of hanging.
 *
 * Provides KeyboardHintsProvider context. The hints bar is rendered below
 * screen content (inside the transition area) so all screens get it.
 */

import { Box } from 'ink';
import { useSyncExternalStore, type ReactNode } from 'react';
import { TitleBar } from '../components/TitleBar.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { KeyboardHintsProvider } from '../hooks/useKeyboardHints.js';
import { DissolveTransition } from './DissolveTransition.js';
import { KeyboardHintsBar } from './KeyboardHintsBar.js';
import { ScreenErrorBoundary } from './ScreenErrorBoundary.js';
import type { WizardStore } from '../store.js';

const MIN_WIDTH = 80;
const MAX_WIDTH = 120;

/** Use terminal width when small so we don't overflow; otherwise clamp to [MIN_WIDTH, MAX_WIDTH]. */
function getContentWidth(terminalColumns: number): number {
  if (terminalColumns < MIN_WIDTH) return terminalColumns;
  return Math.min(MAX_WIDTH, terminalColumns);
}

interface ScreenContainerProps {
  store: WizardStore;
  screens: Record<string, ReactNode>;
}

export const ScreenContainer = ({ store, screens }: ScreenContainerProps) => {
  const [columns, rows] = useStdoutDimensions();
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const terminalWidth = columns;
  const width = getContentWidth(terminalWidth);
  const contentHeight = Math.max(5, rows - 3);
  const contentAreaWidth = Math.max(10, width - 2);
  const direction = store.lastNavDirection === 'pop' ? 'right' : 'left';
  const activeScreen = screens[store.currentScreen] ?? null;

  const inner = (
    <Box flexDirection="column" height={rows} width={width}>
      <TitleBar version={store.version} width={width} />
      <Box height={1} />
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <DissolveTransition
          transitionKey={store.currentScreen}
          width={contentAreaWidth}
          height={contentHeight}
          direction={direction}
        >
          <ScreenErrorBoundary store={store}>
            <Box flexDirection="column" height={contentHeight}>
              <Box
                flexDirection="column"
                flexGrow={1}
                flexShrink={1}
                overflow="hidden"
              >
                {activeScreen}
              </Box>
              <Box height={1} />
              <KeyboardHintsBar />
            </Box>
          </ScreenErrorBoundary>
        </DissolveTransition>
      </Box>
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      height={rows}
      width={terminalWidth}
      alignItems="center"
      justifyContent="flex-start"
    >
      <KeyboardHintsProvider>{inner}</KeyboardHintsProvider>
    </Box>
  );
};
