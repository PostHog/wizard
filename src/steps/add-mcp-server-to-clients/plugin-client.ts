export interface PluginInstallResult {
  success: boolean;
  alreadyInstalled?: boolean;
}

export interface PluginCapable {
  supportsPlugin(): boolean;
  isPluginInstalled(): Promise<boolean>;
  installPlugin(): Promise<PluginInstallResult>;
}

export function isPluginCapable(client: unknown): client is PluginCapable {
  return (
    typeof client === 'object' &&
    client !== null &&
    'supportsPlugin' in client &&
    'installPlugin' in client
  );
}
