import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  detectLanguageFromFiles,
  languageFromIntegration,
} from '../language-detection';
import { Integration } from '../../lib/constants';

describe('languageFromIntegration', () => {
  const cases: [Integration, string | null][] = [
    [Integration.nextjs, 'node'],
    [Integration.nuxt, 'node'],
    [Integration.vue, 'node'],
    [Integration.reactRouter, 'node'],
    [Integration.tanstackStart, 'node'],
    [Integration.tanstackRouter, 'node'],
    [Integration.reactNative, 'node'],
    [Integration.angular, 'node'],
    [Integration.astro, 'node'],
    [Integration.sveltekit, 'node'],
    [Integration.javascript_web, 'node'],
    [Integration.javascriptNode, 'node'],
    [Integration.django, 'python'],
    [Integration.flask, 'python'],
    [Integration.fastapi, 'python'],
    [Integration.python, 'python'],
    [Integration.laravel, 'php'],
    [Integration.rails, 'ruby'],
    [Integration.ruby, 'ruby'],
    [Integration.swift, null],
    [Integration.android, null],
  ];

  test.each(cases)('%s → %s', (integration, expected) => {
    expect(languageFromIntegration(integration)).toBe(expected);
  });
});

describe('detectLanguageFromFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-lang-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('detects node from package.json', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    expect(await detectLanguageFromFiles(tmpDir)).toBe('node');
  });

  test('detects python from requirements.txt', async () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'stripe==5.0.0');
    expect(await detectLanguageFromFiles(tmpDir)).toBe('python');
  });

  test('detects python from pyproject.toml', async () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[project]');
    expect(await detectLanguageFromFiles(tmpDir)).toBe('python');
  });

  test('detects ruby from Gemfile', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Gemfile'),
      "source 'https://rubygems.org'",
    );
    expect(await detectLanguageFromFiles(tmpDir)).toBe('ruby');
  });

  test('detects php from composer.json', async () => {
    fs.writeFileSync(path.join(tmpDir, 'composer.json'), '{}');
    expect(await detectLanguageFromFiles(tmpDir)).toBe('php');
  });

  test('detects go from go.mod', async () => {
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module myapp');
    expect(await detectLanguageFromFiles(tmpDir)).toBe('go');
  });

  test('detects java from build.gradle', async () => {
    fs.writeFileSync(path.join(tmpDir, 'build.gradle'), 'plugins {}');
    expect(await detectLanguageFromFiles(tmpDir)).toBe('java');
  });

  test('detects java from pom.xml', async () => {
    fs.writeFileSync(path.join(tmpDir, 'pom.xml'), '<project></project>');
    expect(await detectLanguageFromFiles(tmpDir)).toBe('java');
  });

  test('detects dotnet from .csproj', async () => {
    fs.writeFileSync(path.join(tmpDir, 'MyApp.csproj'), '<Project></Project>');
    expect(await detectLanguageFromFiles(tmpDir)).toBe('dotnet');
  });

  test('detects dotnet from .sln', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'MyApp.sln'),
      'Microsoft Visual Studio Solution',
    );
    expect(await detectLanguageFromFiles(tmpDir)).toBe('dotnet');
  });

  test('returns null for empty directory', async () => {
    expect(await detectLanguageFromFiles(tmpDir)).toBeNull();
  });

  test('returns first match when multiple indicators present', async () => {
    // node (package.json) comes before python in indicator order
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'stripe');
    expect(await detectLanguageFromFiles(tmpDir)).toBe('node');
  });
});
