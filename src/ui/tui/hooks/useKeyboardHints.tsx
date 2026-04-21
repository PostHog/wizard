/**
 * KeyboardHintsProvider — Context for collecting and displaying keyboard hints.
 *
 * Input components register their hints via useKeyBindings. The provider
 * flattens, deduplicates, and sorts them. It auto-dismisses 3s after the
 * first keypress and resets when the hint set changes (screen navigation).
 */

import { useInput } from 'ink';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  hintsKey,
  deduplicateAndSort,
  type KeyboardHint,
} from './keyboard-hints-utils.js';

export type { KeyboardHint } from './keyboard-hints-utils.js';

interface KeyboardHintsContextValue {
  register(id: string, hints: KeyboardHint[]): void;
  unregister(id: string): void;
  hints: KeyboardHint[];
  visible: boolean;
}

const KeyboardHintsContext = createContext<KeyboardHintsContextValue>({
  register: () => undefined,
  unregister: () => undefined,
  hints: [],
  visible: false,
});

export const useKeyboardHintsContext = () => useContext(KeyboardHintsContext);

const DISMISS_DELAY = 3000;

export const KeyboardHintsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const registrationsRef = useRef(new Map<string, KeyboardHint[]>());
  const [hints, setHints] = useState<KeyboardHint[]>([]);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevHintsKeyRef = useRef('');

  const recompute = useCallback(() => {
    const all: KeyboardHint[] = [];
    for (const h of registrationsRef.current.values()) {
      all.push(...h);
    }
    const deduped = deduplicateAndSort(all);

    const newKey = hintsKey(deduped);
    if (newKey !== prevHintsKeyRef.current) {
      prevHintsKeyRef.current = newKey;
      setHints(deduped);
      // Reset visibility when hints change (new screen)
      if (newKey.length > 0) {
        setVisible(true);
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }
    }
  }, []);

  const register = useCallback(
    (id: string, h: KeyboardHint[]) => {
      registrationsRef.current.set(id, h);
      recompute();
    },
    [recompute],
  );

  const unregister = useCallback(
    (id: string) => {
      registrationsRef.current.delete(id);
      recompute();
    },
    [recompute],
  );

  // Dismiss on first keypress after 3s
  useInput(() => {
    if (!visible) return;
    if (timerRef.current) return; // already counting down
    timerRef.current = setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, DISMISS_DELAY);
  });

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <KeyboardHintsContext.Provider
      value={{ register, unregister, hints, visible }}
    >
      {children}
    </KeyboardHintsContext.Provider>
  );
};
