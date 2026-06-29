/**
 * Leaf-level constants for the events-audit program.
 *
 * Kept separate from `index.ts` so files like `yara-hooks.ts` can import
 * the filename constants without dragging in `index.ts`'s heavier imports
 * (agent-runner, audit/seed, etc.) — which can create import cycles.
 */

export const SETUP_REPORT_FILE = 'posthog-events-audit-report.md';
export const EVENT_INVENTORY_FILE = '.posthog-events-inventory.json';
/** Per-part filename pattern emitted by events-audit subagents (e.g. `.posthog-events-inventory.part-3.json`). */
export const EVENT_INVENTORY_PART_PATTERN =
  /^\.posthog-events-inventory\.part-\d+\.json$/;
