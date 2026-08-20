/**
 * Capability for MCP clients whose editor CLI has its own login command
 * (`claude mcp login`, `codex mcp login`). The editor owns the OAuth token and
 * its refresh, and its login command requires a real terminal — so the wizard
 * never runs it, it surfaces the exact command for the user to run.
 *
 * Mirrors the PluginCapable pattern in plugin-client.ts: the client carries the
 * product knowledge (its command), the TUI renders whatever the capability
 * surfaces.
 */
export interface LoginCapable {
  /** The editor's own login command for the installed server, e.g. `claude mcp login posthog`. */
  loginCommand(local?: boolean): string;
  /**
   * The login command when the server comes from the editor's plugin instead
   * of a config entry (plugin-provided servers have their own name, e.g.
   * `plugin:posthog:posthog`). Absent when the client has no plugin server.
   */
  pluginLoginCommand?(): string;
}

export function isLoginCapable<T>(client: T): client is T & LoginCapable {
  return (
    typeof client === 'object' && client !== null && 'loginCommand' in client
  );
}
