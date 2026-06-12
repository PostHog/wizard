export interface PluginInstallResult {
  success: boolean;
  alreadyInstalled?: boolean;
  /** Client binary is too old or otherwise can't accept the plugin. Not an error worth reporting. */
  unsupported?: boolean;
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
