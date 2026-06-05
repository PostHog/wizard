/**
 * KeyboardHintsProvider — Context for collecting and displaying keyboard hints.
 *
 * Input components register their hints via useKeyBindings. The provider
 * flattens, deduplicates, and sorts them. The hints bar stays visible for as
 * long as a screen has registered hints — it never auto-dismisses.
 */

import {
  createContext,
  useCallback,
  useContext,
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
}

const KeyboardHintsContext = createContext<KeyboardHintsContextValue>({
  register: () => undefined,
  unregister: () => undefined,
  hints: [],
});

export const useKeyboardHintsContext = () => useContext(KeyboardHintsContext);

export const KeyboardHintsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const registrationsRef = useRef(new Map<string, KeyboardHint[]>());
  const [hints, setHints] = useState<KeyboardHint[]>([]);
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

  return (
    <KeyboardHintsContext.Provider value={{ register, unregister, hints }}>
      {children}
    </KeyboardHintsContext.Provider>
  );
};
