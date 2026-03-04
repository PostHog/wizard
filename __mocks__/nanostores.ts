/**
 * CJS-compatible mock for nanostores (ESM-only package).
 * Implements the subset used by WizardStore: atom() and map().
 */

type Listener = () => void;

export function atom<T>(initialValue: T) {
  let value = initialValue;
  const listeners = new Set<Listener>();

  return {
    get(): T {
      return value;
    },
    set(newValue: T): void {
      value = newValue;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(cb: Listener): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

export function map<T extends Record<string, unknown>>(initialValue: T) {
  let value = { ...initialValue };
  const listeners = new Set<Listener>();

  return {
    get(): T {
      return value;
    },
    set(newValue: T): void {
      value = newValue;
      for (const listener of listeners) {
        listener();
      }
    },
    setKey<K extends keyof T>(key: K, val: T[K]): void {
      value = { ...value, [key]: val };
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(cb: Listener): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
