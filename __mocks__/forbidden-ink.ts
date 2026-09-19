/**
 * Alias target for `ink` in every Vitest project except tui and harness. The
 * store, agent, and cli surfaces are Ink free; a test that loads Ink there
 * fails at import time instead of silently rendering nothing.
 */
throw new Error(
  'ink loaded outside the tui surface. Only src/tui may import Ink; see src/__tests__/architecture.',
);
