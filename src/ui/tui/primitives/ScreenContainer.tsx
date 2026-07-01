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

import { Box, useInput } from 'ink';
import { useSyncExternalStore, type ReactNode } from 'react';
import { TitleBar } from '@ui/tui/components/TitleBar';
import { TokenCostHud } from '@ui/tui/components/TokenCostHud';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { KeyboardHintsProvider } from '@ui/tui/hooks/useKeyboardHints';
import { DissolveTransition } from './DissolveTransition.js';
import { KeyboardHintsBar } from './KeyboardHintsBar.js';
import { ScreenErrorBoundary } from './ScreenErrorBoundary.js';
import type { WizardStore } from '@ui/tui/store';

const MIN_WIDTH = 80;
export const MAX_WIDTH = 120;

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

  // Hidden shortcut: Ctrl+T toggles the token/cost HUD. Deliberately not
  // wired through useKeyBindings, so it never appears in the hints bar.
  // Mounted here (not on any individual screen) so it works everywhere —
  // ScreenContainer is the one component alive for the whole process.
  useInput((input, key) => {
    if (key.ctrl && input === 't') store.toggleTokenHud();
  });

  const terminalWidth = columns;
  const width = getContentWidth(terminalWidth);
  const hudVisible = store.tokenHudVisible;
  // The HUD is exactly one row (see TokenCostHud) — budget for it here so
  // adding it doesn't push the screen content past the terminal height.
  const contentHeight = Math.max(5, rows - 3 - (hudVisible ? 1 : 0));
  const contentAreaWidth = Math.max(10, width - 2);
  const direction = store.lastNavDirection === 'pop' ? 'right' : 'left';
  const activeScreen = screens[store.currentScreen] ?? null;

  const inner = (
    <Box flexDirection="column" height={rows} width={width}>
      <TitleBar version={store.version} width={width} />
      <Box height={1} />
      {hudVisible && <TokenCostHud usage={store.tokenUsage} />}
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
