/**
 * useKeyBindings — Declarative keyboard input + automatic hint registration.
 *
 * Replaces raw `useInput` in input components. Define bindings as data;
 * the hook wires up the Ink input handler AND registers hints in the
 * KeyboardHintsProvider. One source of truth for keys and their labels.
 */

import { useInput, type Key } from 'ink';
import { useEffect, useRef } from 'react';
import { useKeyboardHintsContext } from './useKeyboardHints.js';
import {
  matchesKey,
  getDefaultPriority,
  KeyMatch,
  type KeyboardHint,
  type KeyMatchOrChar,
} from './keyboard-hints-utils.js';

export { KeyMatch };
export type { KeyMatchOrChar } from './keyboard-hints-utils.js';

export interface KeyBinding {
  /** Which key(s) trigger this binding. Array = multiple keys, one hint. */
  match: KeyMatchOrChar | KeyMatchOrChar[];
  /** Display label in hints bar (e.g. "↑↓", "space", "enter") */
  label: string;
  /** Description in hints bar (e.g. "navigate", "toggle") */
  action: string;
  /** Ordering priority (lower = further left). Defaults based on key type. */
  priority?: number;
  /** Handler called when the key matches. */
  handler: (input: string, key: Key) => void;
}

/**
 * Declarative key bindings hook. Replaces `useInput` in input components.
 * Registers hints automatically with the KeyboardHintsProvider.
 *
 * @param id Unique identifier for this component's hints registration
 * @param bindings Array of key binding definitions
 */
export function useKeyBindings(id: string, bindings: KeyBinding[]): void {
  const ctx = useKeyboardHintsContext();

  // Extract hints and register. Use a serialized key to avoid unnecessary updates.
  const hintsRef = useRef<string>('');
  const hints: KeyboardHint[] = bindings.map((b) => ({
    label: b.label,
    action: b.action,
    priority: b.priority ?? getDefaultPriority(b.match),
  }));
  const serialized = hints
    .map((h) => `${h.label}:${h.action}:${h.priority}`)
    .join('|');

  useEffect(() => {
    if (serialized !== hintsRef.current) {
      hintsRef.current = serialized;
      ctx.register(id, hints);
    }
    return () => ctx.unregister(id);
    // eslint-disable-next-line
  }, [id, serialized]);

  // Wire up input handling
  useInput((input, key) => {
    for (const binding of bindings) {
      const matches = Array.isArray(binding.match)
        ? binding.match
        : [binding.match];
      if (matches.some((m) => matchesKey(m, input, key))) {
        binding.handler(input, key);
        return;
      }
    }
  });
}
