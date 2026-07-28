export interface PluginInstallResult {
  success: boolean;
  alreadyInstalled?: boolean;
  /**
   * Short, user-facing explanation of why the install didn't happen. Set on
   * failure so the caller can tell the user instead of failing silently.
   */
  hint?: string;
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
