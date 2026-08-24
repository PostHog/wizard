/**
 * Capability for MCP clients whose editor CLI has its own login command
 * (`claude mcp login`, `codex mcp login`). The editor owns the OAuth token and
 * its refresh, and its login command requires a real terminal — so the wizard
 * never runs it, it surfaces the exact command for the user to run.
 */
export interface LoginCapable {
  /** The editor's login command (e.g. `claude mcp login posthog`), or null when unusable right now (CLI absent). */
  loginCommand(local?: boolean): string | null;
  /** The login command when the server comes from the editor's plugin (e.g. `plugin:posthog:posthog`). */
  pluginLoginCommand?(): string;
}

export function isLoginCapable<T>(client: T): client is T & LoginCapable {
  return (
    typeof client === 'object' && client !== null && 'loginCommand' in client
  );
}
