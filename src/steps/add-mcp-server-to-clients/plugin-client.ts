import type { InstallResult } from './results';

export type PluginInstallResult = InstallResult;

export interface PluginCapable {
  supportsPlugin(): boolean;
  isPluginInstalled(): Promise<boolean>;
  installPlugin(): Promise<PluginInstallResult>;
  /** Uninstall the plugin. Absent when the client CLI has no uninstall surface. */
  removePlugin?(): Promise<PluginInstallResult>;
}

export function isPluginCapable<T>(client: T): client is T & PluginCapable {
  return (
    typeof client === 'object' &&
    client !== null &&
    'supportsPlugin' in client &&
    'installPlugin' in client
  );
}
