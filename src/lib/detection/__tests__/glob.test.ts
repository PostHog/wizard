import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DETECTION_IGNORE_PATTERNS, globWithAbort } from '@lib/detection/glob';
import { PYTHON_AGENT_CONFIG } from '../../../frameworks/python/python-wizard-agent';
import { SWIFT_AGENT_CONFIG } from '../../../frameworks/swift/swift-wizard-agent';

const tmpDirs: string[] = [];
function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-glob-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('DETECTION_IGNORE_PATTERNS', () => {
  test('ignores the heavy trees that OOM recursive detection globs', () => {
    expect(DETECTION_IGNORE_PATTERNS).toContain('**/node_modules/**');
    expect(DETECTION_IGNORE_PATTERNS).toContain('**/.git/**');
  });
});

describe('globWithAbort', () => {
  test('behaves like fast-glob when no signal is provided', async () => {
    const dir = project({ 'a.txt': '', 'sub/b.txt': '' });
    const matches = await globWithAbort('**/*.txt', { cwd: dir });
    expect(matches.sort()).toEqual(['a.txt', 'sub/b.txt']);
  });

  test('honours the ignore list', async () => {
    const dir = project({
      'keep.txt': '',
      'node_modules/dep/skip.txt': '',
    });
    const matches = await globWithAbort('**/*.txt', {
      cwd: dir,
      ignore: DETECTION_IGNORE_PATTERNS,
    });
    expect(matches).toEqual(['keep.txt']);
  });

  test('resolves immediately with no matches when the signal is already aborted', async () => {
    const dir = project({ 'a.txt': '' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      globWithAbort('**/*.txt', { cwd: dir, signal: controller.signal }),
    ).resolves.toEqual([]);
  });

  test('resolves (does not hang or throw) when aborted mid-walk', async () => {
    const dir = project({ 'a.txt': '', 'sub/b.txt': '' });
    const controller = new AbortController();
    const promise = globWithAbort('**/*.txt', {
      cwd: dir,
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).resolves.toBeInstanceOf(Array);
  });
});

describe('detectors ignore node_modules (regression: framework-detection OOM)', () => {
  test('Python is not detected from config files buried in node_modules', async () => {
    // A JS project with a Python-based dependency vendored in node_modules must
    // not be mistaken for a Python project — and, more importantly, detection
    // must never walk into node_modules to find out.
    const dir = project({
      'package.json': JSON.stringify({ dependencies: {} }),
      'node_modules/some-dep/requirements.txt': 'requests==2.0.0',
      'node_modules/some-dep/setup.py': 'from setuptools import setup',
    });
    await expect(
      PYTHON_AGENT_CONFIG.detection.detect({ installDir: dir }),
    ).resolves.toBe(false);
  });

  test('Python is still detected from real project config files', async () => {
    const dir = project({ 'requirements.txt': 'requests==2.0.0' });
    await expect(
      PYTHON_AGENT_CONFIG.detection.detect({ installDir: dir }),
    ).resolves.toBe(true);
  });

  test('Swift is not detected from .swift files buried in node_modules', async () => {
    const dir = project({
      'App.xcodeproj/project.pbxproj': '// pbxproj',
      'node_modules/some-dep/Vendored.swift': 'import Foundation',
    });
    await expect(
      SWIFT_AGENT_CONFIG.detection.detect({ installDir: dir }),
    ).resolves.toBe(false);
  });
});
