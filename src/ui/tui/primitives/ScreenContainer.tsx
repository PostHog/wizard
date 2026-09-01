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

import { Box, useInput, useStdout } from 'ink';
import { useSyncExternalStore, type ReactNode } from 'react';
import { TitleBar } from '@ui/tui/components/TitleBar';
import {
  TokenCostHud,
  tokenCostHudRowCount,
} from '@ui/tui/components/TokenCostHud';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { KeyboardHintsProvider } from '@ui/tui/hooks/useKeyboardHints';
import { DissolveTransition } from './DissolveTransition.js';
import { KeyboardHintsBar } from './KeyboardHintsBar.js';
import { ScreenErrorBoundary } from './ScreenErrorBoundary.js';
import {
  ViewportTooSmall,
  isViewportTooSmall,
} from './ViewportTooSmall.js';
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
  const { stdout } = useStdout();
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
  // Text width inside TokenCostHud's own paddingX={1} (1 column each side).
  const hudContentWidth = Math.max(1, width - 2);
  // 1 row when the "Ctrl+T to hide" hint fits on the cost line's row, 2 when
  // it needs its own row below (see tokenCostHudRowCount) — plus a one-row
  // spacer below the HUD. Budget the exact total so it can never disagree
  // with what TokenCostHud actually renders and push content past the
  // terminal height.
  const hudRows = hudVisible
    ? tokenCostHudRowCount(store.tokenUsage, hudContentWidth) + 1
    : 0;
  const contentHeight = Math.max(5, rows - 3 - hudRows);
  const contentAreaWidth = Math.max(10, width - 2);
  const direction = store.lastNavDirection === 'pop' ? 'right' : 'left';
  const activeScreen = screens[store.currentScreen] ?? null;

  // Too small to lay out: hide the screens rather than unmounting them. Yoga
  // drops display:none subtrees from layout entirely, so the hidden tree can't
  // overflow into the notice, and staying mounted keeps a half-typed input
  // alive and — the reason this isn't a plain unmount — stops every screen's
  // mount effects (browser opens, health checks, detection) from re-firing
  // each time someone drags the window edge. The cost is that keypresses
  // still reach the hidden screen; that's how ctrl+c keeps working, and it
  // beats today's behaviour of typing into a garbled one.
  //
  // Only enforced on a real terminal: with stdout piped there are no
  // dimensions to read (useStdoutDimensions substitutes 80×24) and no window
  // for anyone to resize, so nagging would be both wrong and unactionable.
  const tooSmall =
    Boolean(stdout.isTTY) && isViewportTooSmall(columns, rows);

  const inner = (
    <Box
      flexDirection="column"
      height={rows}
      width={width}
      display={tooSmall ? 'none' : 'flex'}
    >
      <TitleBar version={store.version} width={width} />
      <Box height={1} />
      {hudVisible && (
        <>
          <TokenCostHud usage={store.tokenUsage} width={hudContentWidth} />
          <Box height={1} />
        </>
      )}
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
      {tooSmall && <ViewportTooSmall columns={columns} rows={rows} />}
      <KeyboardHintsProvider>{inner}</KeyboardHintsProvider>
    </Box>
  );
};
