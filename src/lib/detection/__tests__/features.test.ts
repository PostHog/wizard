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

describe('discoverFeatures', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('returns empty when no package.json exists', () => {
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
});
