/* Swift wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { swiftPackageManager } from '../lib/package-manager-detection';
import { Integration } from '../lib/constants';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  detectSwiftProjectType,
  getSwiftProjectTypeName,
  SwiftProjectType,
} from './utils';

type SwiftContext = {
  projectType?: SwiftProjectType;
};

export const SWIFT_AGENT_CONFIG: FrameworkConfig<SwiftContext> = {
  metadata: {
    name: 'Swift (iOS/macOS)',
    integration: Integration.swift,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/ios',
    preRunNotice:
      'Please close the Xcode project before proceeding. Xcode may overwrite changes the wizard makes to project files.',
    gatherContext: async (options: WizardOptions) => {
      const projectType = await detectSwiftProjectType(options);
      return { projectType };
    },
  },

  detection: {
    packageName: 'posthog-ios',
    packageDisplayName: 'Swift',
    usesPackageJson: false,
    getVersion: () => undefined,
    detect: async (options) => {
      const { installDir } = options;

      // Check for Xcode project
      const xcodeProjects = await fg('*.xcodeproj', {
        cwd: installDir,
        onlyDirectories: true,
      });

      if (xcodeProjects.length > 0) {
        // Verify it contains Swift source files
        const swiftFiles = await fg('**/*.swift', {
          cwd: installDir,
          ignore: [
            '**/.build/**',
            '**/DerivedData/**',
            '**/build/**',
            '**/*.xcodeproj/**',
            '**/Pods/**',
          ],
        });
        if (swiftFiles.length > 0) {
          return true;
        }
      }

      // Check for Swift Package Manager project
      const packageSwiftPath = path.join(installDir, 'Package.swift');
      if (fs.existsSync(packageSwiftPath)) {
        return true;
      }

      return false;
    },
    detectPackageManager: swiftPackageManager,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      POSTHOG_API_KEY: apiKey,
      POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context) => ({
      projectType: context.projectType || 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a Swift project. Look for .xcodeproj directories, Package.swift, and .swift source files to confirm. Check for SwiftUI or UIKit imports to determine the UI framework.',
    packageInstallation:
      'Add the posthog-ios package via Swift Package Manager. For Xcode projects, add XCRemoteSwiftPackageReference and XCSwiftPackageProductDependency to the .pbxproj file. For Swift packages, add the dependency to Package.swift.',
    getAdditionalContextLines: (context) => {
      const projectTypeName = context.projectType
        ? getSwiftProjectTypeName(context.projectType)
        : 'unknown';

      const lines = [
        `Project type: ${projectTypeName}`,
        `Framework docs ID: swift (use posthog://docs/frameworks/swift for documentation)`,
      ];

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      const projectTypeName = context.projectType
        ? getSwiftProjectTypeName(context.projectType)
        : 'Swift';

      const changes = [
        `Analyzed your ${projectTypeName} project structure`,
        `Added the PostHog iOS SDK via Swift Package Manager`,
        `Configured PostHog initialization in your app entry point`,
        `Added event capture and user identification`,
      ];

      return changes;
    },
    getOutroNextSteps: () => [
      'Set POSTHOG_API_KEY and POSTHOG_HOST in your Xcode scheme environment variables',
      'Build and run your app to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
    ],
  },
};
