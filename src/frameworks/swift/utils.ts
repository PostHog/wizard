import type { WizardRunOptions } from '@utils/types';
import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EXTRA_IGNORE = ['**/.build/**', '**/*.xcodeproj/**'];

/** Import probes read at most this many files — holding one ≤MAX_PROJECT_FILE_BYTES file in memory at a time. */
const SOURCE_PROBE_LIMIT = 200;

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
  const swiftFiles = await boundedGlob('**/*.swift', {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  let hasSwiftUI = false;
  let hasUIKit = false;

  for (const file of swiftFiles) {
    const content = readProjectFile(path.join(installDir, file));
    if (!content) continue;
    if (content.includes('import SwiftUI')) {
      hasSwiftUI = true;
    }
    if (content.includes('import UIKit')) {
      hasUIKit = true;
    }
  }

  if (hasSwiftUI) return SwiftProjectType.SWIFTUI;
  if (hasUIKit) return SwiftProjectType.UIKIT;

  return undefined;
}
