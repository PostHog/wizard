/**
 * useDismissOnAnyKey — "press any key to continue/exit" screens.
 *
 * Wraps `useInput` for the recurring "any key dismisses/exits this screen"
 * pattern (outro screens, terminal error/timeout screens, etc.), ignoring
 * modifier-combo keypresses (Ctrl/Meta) so a global hidden shortcut — e.g.
 * Ctrl+T toggling the token/cost HUD — can't also dismiss the screen
 * underneath it. Ink calls every mounted `useInput` callback for a given
 * keypress with no `stopPropagation`, so a bare `useInput(() => handler())`
 * would otherwise fire on every registered shortcut too, not just an
 * ordinary keypress.
 *
 * Use this instead of raw `useInput` for any screen where any ordinary
 * keypress should proceed, but a modifier combo shouldn't be able to.
 */
import { useInput, type Key } from 'ink';

/**
 * True for a keypress that should NOT count as "any key" for a dismiss
 * handler — currently just modifier combos. Extracted as a pure predicate
 * so it's unit-testable without rendering through Ink.
 */
export function isIgnoredForDismiss(key: Pick<Key, 'ctrl' | 'meta'>): boolean {
  return key.ctrl || key.meta;
}

export function useDismissOnAnyKey(handler: () => void): void {
  useInput((_input, key) => {
    if (isIgnoredForDismiss(key)) return;
    handler();
  });
}
