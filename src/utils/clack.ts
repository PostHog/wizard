import { AsyncLocalStorage } from 'node:async_hooks';
// @ts-ignore - clack is ESM and TS complains about that. It works though
import realClack from '@clack/prompts';

/** When active, output functions become no-ops and interactive prompts throw. */
const silentStore = new AsyncLocalStorage<{ silent: true }>();

/** Output-only methods on clack.log that should be silenced */
const SILENT_LOG_METHODS = new Set([
  'info',
  'warn',
  'error',
  'success',
  'step',
  'message',
]);

/** Interactive prompts that must not run in silent mode */
const INTERACTIVE_METHODS = new Set([
  'select',
  'multiselect',
  'confirm',
  'text',
  'password',
  'groupMultiselect',
]);

/** Top-level output methods that should be silenced */
const SILENT_TOP_LEVEL = new Set(['intro', 'outro', 'note']);

/** No-op spinner returned in silent mode */
function createNoopSpinner() {
  return {
    start: () => {
      /* noop */
    },
    stop: () => {
      /* noop */
    },
    message: () => {
      /* noop */
    },
  };
}

/** Proxy that no-ops output and throws on prompts when silent mode is active. */
const clack: typeof realClack = new Proxy(realClack, {
  get(target, prop, receiver) {
    const isSilent = !!silentStore.getStore();

    if (prop === 'log' && isSilent) {
      // Return a proxy for log.* that no-ops output methods
      return new Proxy(target.log, {
        get(logTarget, logProp) {
          if (typeof logProp === 'string' && SILENT_LOG_METHODS.has(logProp)) {
            return () => {
              /* noop */
            };
          }
          return Reflect.get(logTarget, logProp);
        },
      });
    }

    if (prop === 'spinner' && isSilent) {
      return () => createNoopSpinner();
    }

    if (typeof prop === 'string' && SILENT_TOP_LEVEL.has(prop) && isSilent) {
      return () => {
        /* noop */
      };
    }

    if (typeof prop === 'string' && INTERACTIVE_METHODS.has(prop) && isSilent) {
      return () => {
        throw new Error(
          `Interactive prompt clack.${prop}() called in silent/concurrent mode. ` +
            `This is a bug — interactive prompts must run in the sequential pre-flight phase.`,
        );
      };
    }

    return Reflect.get(target, prop, receiver);
  },
});

/** Run `fn` with clack output silenced. */
export function withSilentOutput<T>(fn: () => Promise<T>): Promise<T> {
  return silentStore.run({ silent: true }, fn);
}

export default clack;
