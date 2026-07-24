import type { WizardRunOptions } from '@utils/types';
import { DETECTION_IGNORE_PATTERNS } from '@lib/detection/glob';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Ignore list for recursive Swift source walks: the shared heavy-tree patterns
 * (node_modules, .git, build, …) plus Swift/Xcode build artifact directories.
 * Without node_modules/.git these globs OOM on large or hybrid repos.
 */
export const SWIFT_SOURCE_IGNORE_PATTERNS = [
  ...DETECTION_IGNORE_PATTERNS,
  '**/.build/**',
  '**/DerivedData/**',
  '**/*.xcodeproj/**',
  '**/Pods/**',
];

export enum SwiftProjectType {
  SWIFTUI = 'swiftui',
  UIKIT = 'uikit',
  SPM = 'spm',
}

export function getSwiftProjectTypeName(projectType: SwiftProjectType): string {
  switch (projectType) {
    case SwiftProjectType.SWIFTUI:
      return 'SwiftUI';
    case SwiftProjectType.UIKIT:
      return 'UIKit';
    case SwiftProjectType.SPM:
      return 'Swift Package';
  }
}

export async function detectSwiftProjectType(
  options: WizardRunOptions,
): Promise<SwiftProjectType | undefined> {
  const { installDir } = options;

  // Pure SPM package: Package.swift with no Xcode project/workspace and no
  // XcodeGen spec (project.yml generates an app's .xcodeproj, often
  // uncommitted) — same app signals as the framework detect glob.
  const hasPackageSwift = fs.existsSync(path.join(installDir, 'Package.swift'));
  const hasXcodeGenSpec = fs.existsSync(path.join(installDir, 'project.yml'));
  const xcodeProjects = await fg('*.{xcodeproj,xcworkspace}', {
    cwd: installDir,
    onlyDirectories: true,
  });

  if (hasPackageSwift && xcodeProjects.length === 0 && !hasXcodeGenSpec) {
    return SwiftProjectType.SPM;
  }

  // Check Swift source files for SwiftUI vs UIKit imports
  const swiftFiles = await fg('**/*.swift', {
    cwd: installDir,
    ignore: SWIFT_SOURCE_IGNORE_PATTERNS,
  });

  let hasSwiftUI = false;
  let hasUIKit = false;

  for (const file of swiftFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, file), 'utf-8');
      if (content.includes('import SwiftUI')) {
        hasSwiftUI = true;
      }
      if (content.includes('import UIKit')) {
        hasUIKit = true;
      }
    } catch {
      continue;
    }
  }

  if (hasSwiftUI) return SwiftProjectType.SWIFTUI;
  if (hasUIKit) return SwiftProjectType.UIKIT;

  return undefined;
}
