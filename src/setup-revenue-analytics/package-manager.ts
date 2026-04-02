/**
 * Map language to the appropriate package manager detector.
 */

import type { PackageManagerDetector } from '../lib/package-manager-detection';
import {
  detectNodePackageManagers,
  detectPythonPackageManagers,
  composerPackageManager,
  bundlerPackageManager,
  gradlePackageManager,
} from '../lib/package-manager-detection';
import type { Language } from './types';

const DETECTORS: Record<Language, PackageManagerDetector> = {
  node: detectNodePackageManagers,
  python: detectPythonPackageManagers,
  php: () => composerPackageManager(),
  ruby: () => bundlerPackageManager(),
  java: () => gradlePackageManager(),
  go: () =>
    Promise.resolve({
      detected: [{ name: 'go', label: 'Go Modules', installCommand: 'go get' }],
      primary: { name: 'go', label: 'Go Modules', installCommand: 'go get' },
      recommendation: 'Use Go Modules (go get).',
    }),
  dotnet: () =>
    Promise.resolve({
      detected: [
        {
          name: 'nuget',
          label: 'NuGet',
          installCommand: 'dotnet add package',
        },
      ],
      primary: {
        name: 'nuget',
        label: 'NuGet',
        installCommand: 'dotnet add package',
      },
      recommendation: 'Use NuGet (dotnet add package).',
    }),
};

export function detectPackageManager(
  language: Language,
): PackageManagerDetector {
  return DETECTORS[language];
}
