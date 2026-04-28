import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { discoverFeatures } from '../features.js';
import { DiscoveredFeature } from '../../wizard-session.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'features-detect-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writePackageJson(
  dir: string,
  deps: Record<string, string> = {},
): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: deps }),
  );
}

function writeFile(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content);
}

describe('discoverFeatures', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('returns empty when no manifest exists', () => {
    expect(discoverFeatures(tmpDir)).toEqual([]);
  });

  it('detects Stripe and LLM features from known packages', () => {
    writePackageJson(tmpDir, { stripe: '13.0.0', openai: '4.0.0' });
    const features = discoverFeatures(tmpDir);

    expect(features).toContain(DiscoveredFeature.Stripe);
    expect(features).toContain(DiscoveredFeature.LLM);
    expect(features).toHaveLength(2);
  });

  it('returns empty for unrelated dependencies', () => {
    writePackageJson(tmpDir, { react: '18.0.0', express: '4.0.0' });
    expect(discoverFeatures(tmpDir)).toEqual([]);
  });

  it('handles malformed package.json gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not valid json');
    expect(discoverFeatures(tmpDir)).toEqual([]);
  });

  describe('Python dependency manifests', () => {
    it('detects LLM from requirements.txt', () => {
      writeFile(
        tmpDir,
        'requirements.txt',
        ['# top comment', '-r other.txt', 'openai==1.50.0', 'flask>=3.0'].join(
          '\n',
        ),
      );
      expect(discoverFeatures(tmpDir)).toEqual([DiscoveredFeature.LLM]);
    });

    it('handles requirements.txt extras and version operators', () => {
      writeFile(
        tmpDir,
        'requirements.txt',
        'anthropic[bedrock] >= 0.30.0; python_version >= "3.10"',
      );
      expect(discoverFeatures(tmpDir)).toEqual([DiscoveredFeature.LLM]);
    });

    it('detects LLM from PEP 621 pyproject.toml dependencies', () => {
      writeFile(
        tmpDir,
        'pyproject.toml',
        [
          '[project]',
          'name = "demo"',
          'dependencies = [',
          '  "fastapi>=0.110",',
          '  "anthropic>=0.30",',
          ']',
        ].join('\n'),
      );
      expect(discoverFeatures(tmpDir)).toEqual([DiscoveredFeature.LLM]);
    });

    it('detects LLM from Poetry pyproject.toml dependencies and ignores python pin', () => {
      writeFile(
        tmpDir,
        'pyproject.toml',
        [
          '[tool.poetry.dependencies]',
          'python = "^3.11"',
          'langchain = "^0.1.0"',
          '',
          '[tool.poetry.group.dev.dependencies]',
          'pytest = "*"',
        ].join('\n'),
      );
      expect(discoverFeatures(tmpDir)).toEqual([DiscoveredFeature.LLM]);
    });

    it('detects LLM from legacy Poetry dev-dependencies section', () => {
      writeFile(
        tmpDir,
        'pyproject.toml',
        [
          '[tool.poetry.dev-dependencies]',
          'litellm = "^1.0"',
          'pytest = "*"',
        ].join('\n'),
      );
      expect(discoverFeatures(tmpDir)).toEqual([DiscoveredFeature.LLM]);
    });

    it('detects LLM from Pipfile [packages] and normalizes underscores', () => {
      writeFile(
        tmpDir,
        'Pipfile',
        [
          '[packages]',
          'flask = "*"',
          'llama_index = "*"',
          '',
          '[dev-packages]',
          'pytest = "*"',
        ].join('\n'),
      );
      expect(discoverFeatures(tmpDir)).toEqual([DiscoveredFeature.LLM]);
    });

    it('returns empty for Python projects with no LLM deps', () => {
      writeFile(
        tmpDir,
        'requirements.txt',
        ['flask==3.0', 'sqlalchemy==2.0'].join('\n'),
      );
      writeFile(
        tmpDir,
        'pyproject.toml',
        ['[project]', 'dependencies = ["fastapi"]'].join('\n'),
      );
      expect(discoverFeatures(tmpDir)).toEqual([]);
    });

    it('does not double-emit LLM when both Node and Python manifests have LLM deps', () => {
      writePackageJson(tmpDir, { openai: '4.0.0' });
      writeFile(tmpDir, 'requirements.txt', 'anthropic==0.30.0');
      expect(discoverFeatures(tmpDir)).toEqual([DiscoveredFeature.LLM]);
    });
  });
});
