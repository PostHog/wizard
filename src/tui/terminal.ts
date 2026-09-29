/**
 * Terminal setup shared by the wizard TUI and the primitives playground.
 *
 * Both enter the alternate screen buffer and paint a black background so
 * Ink renders on a consistent dark canvas regardless of the user's terminal
 * theme (light mode profiles included).
 */

// ANSI escape sequences
const RESET_ATTRS = '\x1b[0m';
const CLEAR_SCREEN = '\x1b[2J';
const CURSOR_HOME = '\x1b[H';
const BG_BLACK = '\x1b[48;2;0;0;0m';
const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';

/** Enter alt screen and paint a black background. */
export function enterDarkTerminal(): void {
  process.stdout.write(
    ENTER_ALT_SCREEN + BG_BLACK + CLEAR_SCREEN + CURSOR_HOME,
  );
}

/** Leave alt screen and reset attributes. */
export function releaseTerminal(): void {
  process.stdout.write(RESET_ATTRS + LEAVE_ALT_SCREEN);
}
