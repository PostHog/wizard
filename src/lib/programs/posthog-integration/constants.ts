/**
 * Leaf-level constants for the posthog-integration program.
 *
 * Kept separate from `index.ts` so leaf consumers (e.g. task-stream tests)
 * can import the filename constants without dragging in `index.ts`'s
 * heavier imports (agent-interface, framework-config, etc.) — which would
 * create import cycles. The security hooks no longer import these directly:
 * `index.ts` declares EVENT_PLAN_FILE as `ProgramConfig.docPaths` and the
 * shared doc-paths registry carries it to L2 (wizard#594).
 */

export const EVENT_PLAN_FILE = '.posthog-events.json';
