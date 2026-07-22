import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectFramework } from '@lib/detection/framework';
import { Integration } from '@lib/constants';
import { ANDROID_AGENT_CONFIG } from '../../../frameworks/android/android-wizard-agent';
import { KMP_AGENT_CONFIG } from '../../../frameworks/kmp/kmp-wizard-agent';
import { FLUTTER_AGENT_CONFIG } from '../../../frameworks/flutter/flutter-wizard-agent';

/** A throwaway project dir seeded with the given files. */
function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

const tmpDirs: string[] = [];
function project(files: Record<string, string>): { installDir: string } {
  const dir = makeProject(files);
  tmpDirs.push(dir);
  return { installDir: dir };
}

afterAll(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Integration enum order (drives first-match detection)', () => {
  const order = Object.values(Integration);
  const fallbacks = [
    Integration.python,
    Integration.ruby,
    Integration.javascript_web,
    Integration.javascriptNode,
  ];

  test('every language fallback comes after every framework', () => {
    const firstFallback = Math.min(...fallbacks.map((f) => order.indexOf(f)));
    const lastFramework = Math.max(
      ...order
        .filter((i) => !fallbacks.includes(i))
        .map((i) => order.indexOf(i)),
    );
    expect(firstFallback).toBeGreaterThan(lastFramework);
  });

  test('generic Node is the last resort of the entire detection', () => {
    // javascriptNode matches any package.json; anything after it is unreachable.
    expect(order[order.length - 1]).toBe(Integration.javascriptNode);
  });

  test('flutter is ordered before android and swift (its subtrees look native)', () => {
    // A Flutter project carries android/ and ios/ subtrees that would
    // otherwise match the native detectors.
    expect(order.indexOf(Integration.flutter)).toBeLessThan(
      order.indexOf(Integration.android),
    );
    expect(order.indexOf(Integration.flutter)).toBeLessThan(
      order.indexOf(Integration.swift),
    );
  });

  test('kmp is ordered before android and swift (more specific detection wins)', () => {
    // A KMP project also looks like an Android/Swift project, so KMP must be
    // checked first for first-match detection to resolve it correctly.
    expect(order.indexOf(Integration.kmp)).toBeLessThan(
      order.indexOf(Integration.android),
    );
    expect(order.indexOf(Integration.kmp)).toBeLessThan(
      order.indexOf(Integration.swift),
    );
  });
});

describe('detectFramework (end-to-end over real project dirs)', () => {
  test('a framework beats the fallbacks even though package.json matches Node', async () => {
    const opts = project({
      'package.json': JSON.stringify({
        dependencies: { next: '^16', react: '^19' },
      }),
      'package-lock.json': '{}',
    });
    await expect(detectFramework(opts.installDir)).resolves.toBe(
      Integration.nextjs,
    );
  });

  test('a Vite React app resolves to javascript_web, not javascript_node', async () => {
    const opts = project({
      'package.json': JSON.stringify({
        dependencies: { react: '^19', 'react-dom': '^19' },
        devDependencies: { vite: '^6' },
      }),
      'package-lock.json': '{}',
      'vite.config.ts': 'export default {}',
      'index.html': '<html></html>',
    });
    await expect(detectFramework(opts.installDir)).resolves.toBe(
      Integration.javascript_web,
    );
  });

  test('a plain browser app (lockfile + index.html, no bundler) resolves to javascript_web', async () => {
    const opts = project({
      'package.json': JSON.stringify({ dependencies: {} }),
      'package-lock.json': '{}',
      'index.html': '<html></html>',
    });
    await expect(detectFramework(opts.installDir)).resolves.toBe(
      Integration.javascript_web,
    );
  });

  test('a server-side Node project still falls through to javascript_node', async () => {
    const opts = project({
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
      'package-lock.json': '{}',
    });
    await expect(detectFramework(opts.installDir)).resolves.toBe(
      Integration.javascriptNode,
    );
  });

  test('a Kotlin Multiplatform project resolves to kmp', async () => {
    const opts = project({
      'settings.gradle.kts': 'include(":shared")',
      'shared/build.gradle.kts': `plugins { kotlin("multiplatform") }\nkotlin {\n  sourceSets {\n    commonMain.dependencies {}\n  }\n}\n`,
      'shared/src/commonMain/kotlin/App.kt': 'class App',
    });
    await expect(detectFramework(opts.installDir)).resolves.toBe(
      Integration.kmp,
    );
  });

  test('a plain Android project still resolves to android (kmp ordered ahead does not hijack it)', async () => {
    const opts = project({
      'build.gradle': `plugins { id 'com.android.application' }`,
      'app/src/main/AndroidManifest.xml': '<manifest/>',
      'app/src/main/kotlin/MainActivity.kt': 'class MainActivity',
    });
    await expect(detectFramework(opts.installDir)).resolves.toBe(
      Integration.android,
    );
  });

  test('a Flutter project resolves to flutter, not its android/ subtree', async () => {
    const opts = project({
      'pubspec.yaml': FLUTTER_PUBSPEC,
      'android/build.gradle': `plugins { id 'com.android.application' }`,
      'android/app/src/main/AndroidManifest.xml': '<manifest/>',
      'android/app/src/main/kotlin/MainActivity.kt': 'class MainActivity',
    });
    await expect(detectFramework(opts.installDir)).resolves.toBe(
      Integration.flutter,
    );
  });
});

const FLUTTER_PUBSPEC =
  'name: my_flutter_app\n' +
  'environment:\n' +
  '  sdk: ^3.0.0\n' +
  'dependencies:\n' +
  '  flutter:\n' +
  '    sdk: flutter\n';

describe('flutter detect', () => {
  const detect = FLUTTER_AGENT_CONFIG.detection.detect;

  test('claims a project whose pubspec depends on the Flutter SDK', async () => {
    const opts = project({ 'pubspec.yaml': FLUTTER_PUBSPEC });
    await expect(detect(opts)).resolves.toBe(true);
  });

  test('does not claim a pure Dart project', async () => {
    const opts = project({
      'pubspec.yaml': 'name: my_dart_cli\nenvironment:\n  sdk: ^3.0.0\n',
    });
    await expect(detect(opts)).resolves.toBe(false);
  });

  test('does not claim a project without a pubspec', async () => {
    const opts = project({ 'package.json': '{}' });
    await expect(detect(opts)).resolves.toBe(false);
  });
});

describe('android detect', () => {
  const detect = ANDROID_AGENT_CONFIG.detection.detect;

  const androidGradle = `plugins { id 'com.android.application' }`;

  test('claims a native Android project', async () => {
    const opts = project({ 'build.gradle': androidGradle });
    await expect(detect(opts)).resolves.toBe(true);
  });

  test('does not claim a Flutter project despite its android/ subtree', async () => {
    const opts = project({
      'pubspec.yaml': 'name: my_flutter_app\nenvironment:\n  sdk: ^3.0.0\n',
      'android/build.gradle': androidGradle,
      'android/app/src/main/AndroidManifest.xml': '<manifest/>',
      'android/app/src/main/kotlin/MainActivity.kt': 'class MainActivity',
    });
    await expect(detect(opts)).resolves.toBe(false);
  });
});

describe('kmp detect', () => {
  const detect = KMP_AGENT_CONFIG.detection.detect;

  test('claims a project applying the Kotlin Multiplatform plugin', async () => {
    const opts = project({
      'shared/build.gradle.kts': `plugins { kotlin("multiplatform") }`,
    });
    await expect(detect(opts)).resolves.toBe(true);
  });

  test('claims a project with a commonMain source set', async () => {
    const opts = project({
      'shared/src/commonMain/kotlin/App.kt': 'class App',
    });
    await expect(detect(opts)).resolves.toBe(true);
  });

  test('does not claim a plain Android project', async () => {
    const opts = project({
      'build.gradle': `plugins { id 'com.android.application' }`,
      'app/src/main/kotlin/MainActivity.kt': 'class MainActivity',
    });
    await expect(detect(opts)).resolves.toBe(false);
  });

  test('does not claim a Flutter project', async () => {
    const opts = project({
      'pubspec.yaml': 'name: my_flutter_app\nenvironment:\n  sdk: ^3.0.0\n',
      'android/build.gradle': `plugins { id 'com.android.application' }`,
      'android/app/src/main/kotlin/MainActivity.kt': 'class MainActivity',
    });
    await expect(detect(opts)).resolves.toBe(false);
  });
});
