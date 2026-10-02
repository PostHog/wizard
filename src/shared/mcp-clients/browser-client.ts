/**
 * Capability for MCP clients that are connected by opening a hosted page in
 * the browser rather than writing a local config or running a CLI install.
 *
 * Mirrors the PluginCapable pattern in plugin-client.ts: the client carries the
 * URL and instruction text (product knowledge); the TUI renders whatever the
 * capability surfaces (generic machinery).
 */

export interface BrowserFinishable {
  /** URL the user opens to finish connecting (also shown as copy-paste fallback). */
  connectorUrl: string;
  /** One-line instruction shown after the page opens. */
  finishInstruction: string;
}

export function isBrowserFinishable<T>(c: T): c is T & BrowserFinishable {
  return (
    typeof c === 'object' &&
    c !== null &&
    'connectorUrl' in c &&
    'finishInstruction' in c
  );
}
