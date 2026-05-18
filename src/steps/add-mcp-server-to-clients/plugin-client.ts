export interface PluginInstallResult {
  success: boolean;
  alreadyInstalled?: boolean;
}

export interface PluginCapable {
  supportsPlugin(): boolean;
  isPluginInstalled(): Promise<boolean>;
  installPlugin(): Promise<PluginInstallResult>;
}

export function isPluginCapable<T>(client: T): client is T & PluginCapable {
  return (
    typeof client === 'object' &&
    client !== null &&
    'supportsPlugin' in client &&
    'installPlugin' in client
  );
}

// Errors emitted by an MCP host CLI (Claude Code, Codex, …) when its own
// pre-existing user config is malformed — i.e. the wizard's command was
// rejected before it could run, because of state outside the wizard's scope.
// We must not capture these as wizard exceptions.
const EXTERNAL_CLIENT_CONFIG_ERROR_PATTERNS: RegExp[] = [
  // Claude Code: malformed plugin entries in ~/.claude config, e.g.
  // "Invalid schema: plugins.5.source: Invalid input"
  /Invalid schema:[^\n]*plugins\.\d+\./i,
];

export function isExternalClientConfigError(message: string): boolean {
  if (!message) return false;
  return EXTERNAL_CLIENT_CONFIG_ERROR_PATTERNS.some((p) => p.test(message));
}
