import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectFramework } from '@lib/detection/framework';
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

describe('detection registry order', () => {
  test('language fallbacks come after every framework', () => {
    // detectFramework loops Object.values(Integration) first-match-wins, so a
    // generic fallback placed before a framework would shadow it. Guard the
    // ordering: every language fallback must sit after the last framework.
    const order = Object.values(Integration);
    const fallbacks = [
      Integration.python,
      Integration.ruby,
      Integration.javascriptNode,
      Integration.javascript_web,
    ];
    const lastFramework = Math.max(
      ...order
        .filter((i) => !fallbacks.includes(i))
        .map((i) => order.indexOf(i)),
    );
    for (const fallback of fallbacks) {
      expect(order.indexOf(fallback)).toBeGreaterThan(lastFramework);
    }
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
