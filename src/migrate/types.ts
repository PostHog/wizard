import type { CloudRegion, WizardOptions } from '../utils/types';
import type { PackageDotJson } from '../utils/package-json';
import type { PackageManager } from '../utils/package-manager';

export interface InstalledPackage {
  packageName: string;
  version: string;
}

export interface MigrationProviderConfig {
  id: string;
  name: string;
  packages: readonly string[];
  docsUrl: string;
  getPostHogEquivalent: (sourcePackage: string) => string | undefined;
  getMigrationDocs: (options: MigrationDocsOptions) => string;
  defaultChanges: string;
  nextSteps: string;
}

export interface MigrationDocsOptions {
  language: 'typescript' | 'javascript';
  envVarPrefix: string;
  framework: 'react' | 'nextjs' | 'svelte' | 'astro' | 'react-native' | 'node';
}

export interface MigrationOptions extends WizardOptions {
  targetIntegration?: string;
}

export interface MigrationContext {
  options: MigrationOptions;
  cloudRegion: CloudRegion;
  packageJson: PackageDotJson;
  provider: MigrationProviderConfig;
  installedPackages: InstalledPackage[];
  framework: 'react' | 'nextjs' | 'svelte' | 'astro' | 'react-native' | 'node';
  envVarPrefix: string;
  typeScriptDetected: boolean;
  accessToken: string;
  projectApiKey: string;
  host: string;
  projectId: number;
}

export interface MigrationOutroOptions {
  options: WizardOptions;
  cloudRegion: CloudRegion;
  provider: MigrationProviderConfig;
  addedEditorRules: boolean;
  packageManager: PackageManager;
  envFileChanged?: string;
  uploadedEnvVars: string[];
  migratedFilesCount: number;
}
