export type PluginScope = 'user' | 'project' | 'both';

export const DEFAULT_PLUGIN_SCOPE: PluginScope = 'user';

export interface PluginInstallResult {
  success: boolean;
  alreadyInstalled?: boolean;
}

export interface PluginCapable {
  supportsPlugin(): boolean;
  isPluginInstalled(): Promise<boolean>;
  installPlugin(scope?: PluginScope): Promise<PluginInstallResult>;
}

export function isPluginCapable<T>(client: T): client is T & PluginCapable {
  return (
    typeof client === 'object' &&
    client !== null &&
    'supportsPlugin' in client &&
    'installPlugin' in client
  );
}
