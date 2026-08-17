import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectSwiftProjectType, SwiftProjectType } from '../utils';
import type { WizardRunOptions } from '@utils/types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swift-utils-'));
}

function options(installDir: string): WizardRunOptions {
  return {
    installDir,
    ci: true,
    debug: false,
    default: false,
    benchmark: false,
    yaraReport: false,
    signup: false,
    localMcp: false,
  };
}

const SWIFTUI_SRC = 'import SwiftUI\nstruct A: App {}\n';
const UIKIT_SRC = 'import UIKit\nclass D: UIResponder {}\n';

describe('detectSwiftProjectType', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('classifies a bare Package.swift as a Swift package', async () => {
    fs.writeFileSync(path.join(dir, 'Package.swift'), '// swift-tools');
    expect(await detectSwiftProjectType(options(dir))).toBe(
      SwiftProjectType.SPM,
    );
  });

  it('does not classify Package.swift + XcodeGen spec as a package', async () => {
    // An app defined by project.yml (generated .xcodeproj uncommitted) with a
    // local Swift module alongside — an app, not a package.
    fs.writeFileSync(path.join(dir, 'Package.swift'), '// swift-tools');
    fs.writeFileSync(path.join(dir, 'project.yml'), 'name: App\ntargets: {}\n');
    fs.writeFileSync(path.join(dir, 'App.swift'), SWIFTUI_SRC);
    expect(await detectSwiftProjectType(options(dir))).toBe(
      SwiftProjectType.SWIFTUI,
    );
  });

  it('does not classify Package.swift + .xcworkspace as a package', async () => {
    fs.writeFileSync(path.join(dir, 'Package.swift'), '// swift-tools');
    fs.mkdirSync(path.join(dir, 'App.xcworkspace'));
    fs.writeFileSync(path.join(dir, 'Delegate.swift'), UIKIT_SRC);
    expect(await detectSwiftProjectType(options(dir))).toBe(
      SwiftProjectType.UIKIT,
    );
  });

  it('classifies an XcodeGen app without Package.swift by its sources', async () => {
    fs.writeFileSync(path.join(dir, 'project.yml'), 'name: App\ntargets: {}\n');
    fs.writeFileSync(path.join(dir, 'App.swift'), SWIFTUI_SRC);
    expect(await detectSwiftProjectType(options(dir))).toBe(
      SwiftProjectType.SWIFTUI,
    );
  });
});
