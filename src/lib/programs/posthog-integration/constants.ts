/**
 * Leaf-level constants for the posthog-integration program.
 *
 * Kept separate from `index.ts` so files like `yara-hooks.ts` can import
 * the filename constants without dragging in `index.ts`'s heavier imports
 * (agent-interface, framework-config, etc.) — which would create an import
 * cycle through agent-interface → yara-hooks.
 */

export const EVENT_PLAN_FILE = '.posthog-events.json';
