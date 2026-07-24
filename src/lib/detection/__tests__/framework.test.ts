import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectFramework } from '@lib/detection/framework';
import { Integration } from '@lib/constants';
import { ANDROID_AGENT_CONFIG } from '../../../frameworks/android/android-wizard-agent';
import { KMP_AGENT_CONFIG } from '../../../frameworks/kmp/kmp-wizard-agent';
import { ELIXIR_AGENT_CONFIG } from '../../../frameworks/elixir/elixir-wizard-agent';

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

  test('a Phoenix project resolves to elixir', async () => {
    const opts = project({
      'mix.exs':
        'defmodule MyApp.MixProject do\n  use Mix.Project\n\n  def project do\n    [app: :my_app, deps: deps()]\n  end\n\n  defp deps do\n    [{:phoenix, "~> 1.7"}]\n  end\nend\n',
      'config/config.exs': 'import Config',
    });
    await expect(detectFramework(opts.installDir)).resolves.toBe(
      Integration.elixir,
    );
  });

  test('a Flutter project is not claimed by anything', async () => {
    const opts = project({
      'pubspec.yaml': 'name: my_flutter_app\nenvironment:\n  sdk: ^3.0.0\n',
      'android/build.gradle': `plugins { id 'com.android.application' }`,
      'android/app/src/main/AndroidManifest.xml': '<manifest/>',
      'android/app/src/main/kotlin/MainActivity.kt': 'class MainActivity',
    });
    await expect(detectFramework(opts.installDir)).resolves.toBeUndefined();
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

describe('elixir detect', () => {
  const detect = ELIXIR_AGENT_CONFIG.detection.detect;

  const mixExs =
    'defmodule MyApp.MixProject do\n  use Mix.Project\n\n  def project do\n    [app: :my_app]\n  end\nend\n';

  test('claims a Mix project', async () => {
    const opts = project({ 'mix.exs': mixExs });
    await expect(detect(opts)).resolves.toBe(true);
  });

  test('does not claim a mix.exs without a project definition', async () => {
    const opts = project({ 'mix.exs': '# placeholder\n' });
    await expect(detect(opts)).resolves.toBe(false);
  });

  test('does not claim a project without a mix.exs', async () => {
    const opts = project({ 'lib/my_app.ex': 'defmodule MyApp do\nend\n' });
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
