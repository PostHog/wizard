import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DETECTION_ORDER, detectFramework } from '@lib/detection/framework';
import { Integration } from '@lib/constants';
import { JAVASCRIPT_NODE_AGENT_CONFIG } from '../../../frameworks/javascript-node/javascript-node-wizard-agent';
import { ANDROID_AGENT_CONFIG } from '../../../frameworks/android/android-wizard-agent';

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

const FALLBACKS = [
  Integration.python,
  Integration.ruby,
  Integration.javascript_web,
  Integration.javascriptNode,
];

describe('DETECTION_ORDER (fallback phase invariants)', () => {
  test('covers every Integration exactly once', () => {
    expect([...DETECTION_ORDER].sort()).toEqual(
      Object.values(Integration).sort(),
    );
    expect(new Set(DETECTION_ORDER).size).toBe(DETECTION_ORDER.length);
  });

  test('every language fallback comes after every framework', () => {
    // Broad fallback predicates (any package.json, any .py file) would
    // shadow specific frameworks if tried earlier.
    const firstFallback = Math.min(
      ...FALLBACKS.map((f) => DETECTION_ORDER.indexOf(f)),
    );
    const lastFramework = Math.max(
      ...DETECTION_ORDER.filter((i) => !FALLBACKS.includes(i)).map((i) =>
        DETECTION_ORDER.indexOf(i),
      ),
    );
    expect(firstFallback).toBeGreaterThan(lastFramework);
  });

  test('generic Node is the last resort of the entire detection', () => {
    // javascriptNode matches on package.json alone — anything after it would
    // be unreachable for any JS project.
    expect(DETECTION_ORDER[DETECTION_ORDER.length - 1]).toBe(
      Integration.javascriptNode,
    );
  });

  test('javascript_web is tried before javascriptNode', () => {
    // web requires a lockfile + a frontend signal; node requires only
    // package.json. Specific before broad, or web is unreachable.
    expect(DETECTION_ORDER.indexOf(Integration.javascript_web)).toBeLessThan(
      DETECTION_ORDER.indexOf(Integration.javascriptNode),
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
    // The ordering fix beyond Vite: before the explicit fallback phase,
    // javascriptNode sat ahead of javascript_web and claimed every frontend
    // project that matched no specific framework.
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

describe('javascript-node detect (generic Node fallback)', () => {
  const detect = JAVASCRIPT_NODE_AGENT_CONFIG.detection.detect;

  test('claims a plain Node project', async () => {
    const opts = project({
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
    });
    await expect(detect(opts)).resolves.toBe(true);
  });

  test('does not claim a project with vite in devDependencies', async () => {
    const opts = project({
      'package.json': JSON.stringify({
        dependencies: { react: '^19' },
        devDependencies: { vite: '^6' },
      }),
    });
    await expect(detect(opts)).resolves.toBe(false);
  });

  test('does not claim a project with a vite config file', async () => {
    for (const config of ['vite.config.ts', 'vite.config.mjs']) {
      const opts = project({
        'package.json': JSON.stringify({ dependencies: {} }),
        [config]: 'export default {}',
      });
      await expect(detect(opts)).resolves.toBe(false);
    }
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
