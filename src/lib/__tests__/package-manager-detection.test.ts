import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectNodePackageManagers,
  detectPythonPackageManagers,
  composerPackageManager,
  swiftPackageManager,
  gradlePackageManager,
} from '../package-manager-detection';

jest.mock('../../utils/debug');
jest.mock('../../telemetry', () => ({
  traceStep: (_name: string, fn: () => unknown) => fn(),
}));
jest.mock('../../utils/analytics', () => ({
  analytics: { setTag: jest.fn() },
}));

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pm-detect-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Node.js detection
// ---------------------------------------------------------------------------

describe('detectNodePackageManagers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('returns empty when no lockfile exists', async () => {
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.detected).toHaveLength(0);
    expect(result.primary).toBeNull();
    expect(result.recommendation).toContain('No lockfile found');
  });

  it('detects npm via package-lock.json', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.detected).toHaveLength(1);
    expect(result.primary?.name).toBe('npm');
    expect(result.primary?.installCommand).toBe('npm add');
    expect(result.recommendation).toContain('npm');
  });

  it('detects pnpm via pnpm-lock.yaml', async () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.detected).toHaveLength(1);
    expect(result.primary?.name).toBe('pnpm');
    expect(result.primary?.installCommand).toBe('pnpm add');
  });

  it('detects yarn v1 via yarn.lock', async () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '# yarn lockfile v1\n');
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.detected).toHaveLength(1);
    expect(result.primary?.name).toBe('yarn');
    expect(result.primary?.label).toContain('V1');
  });

  it('detects yarn v2+ via yarn.lock with __metadata', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'yarn.lock'),
      '__metadata:\n  version: 8\n',
    );
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.detected).toHaveLength(1);
    expect(result.primary?.name).toBe('yarn');
    expect(result.primary?.label).toContain('V2');
  });

  it('detects bun via bun.lockb', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.detected).toHaveLength(1);
    expect(result.primary?.name).toBe('bun');
    expect(result.primary?.installCommand).toBe('bun add');
  });

  it('detects multiple package managers', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.detected.length).toBeGreaterThanOrEqual(2);
    expect(result.recommendation).toContain('Multiple');
  });

  it('includes runCommand in detected entries', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.primary?.runCommand).toBe('npm run');
  });
});

// ---------------------------------------------------------------------------
// Python detection
// ---------------------------------------------------------------------------

describe('detectPythonPackageManagers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('detects uv via uv.lock', async () => {
    fs.writeFileSync(path.join(tmpDir, 'uv.lock'), '');
    const result = await detectPythonPackageManagers(tmpDir);
    expect(result.primary?.name).toBe('uv');
    expect(result.primary?.installCommand).toBe('uv add');
    expect(result.primary?.runCommand).toBe('uv run');
  });

  it('detects poetry via pyproject.toml [tool.poetry]', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[tool.poetry]\nname = "test"\n',
    );
    const result = await detectPythonPackageManagers(tmpDir);
    expect(result.primary?.name).toBe('poetry');
    expect(result.primary?.installCommand).toBe('poetry add');
  });

  it('detects poetry via poetry.lock', async () => {
    fs.writeFileSync(path.join(tmpDir, 'poetry.lock'), '');
    const result = await detectPythonPackageManagers(tmpDir);
    expect(result.primary?.name).toBe('poetry');
  });

  it('detects pdm via pyproject.toml [tool.pdm]', async () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[tool.pdm]\n');
    const result = await detectPythonPackageManagers(tmpDir);
    expect(result.primary?.name).toBe('pdm');
  });

  it('detects pipenv via Pipfile', async () => {
    fs.writeFileSync(path.join(tmpDir, 'Pipfile'), '');
    const result = await detectPythonPackageManagers(tmpDir);
    expect(result.primary?.name).toBe('pipenv');
    expect(result.primary?.installCommand).toBe('pipenv install');
  });

  it('detects conda via environment.yml', async () => {
    fs.writeFileSync(path.join(tmpDir, 'environment.yml'), '');
    const result = await detectPythonPackageManagers(tmpDir);
    expect(result.primary?.name).toBe('conda');
  });

  it('detects pip via requirements.txt', async () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'flask==2.0\n');
    const result = await detectPythonPackageManagers(tmpDir);
    expect(result.primary?.name).toBe('pip');
    expect(result.primary?.installCommand).toBe('pip install');
  });

  it('falls back to unknown when no markers exist', async () => {
    const result = await detectPythonPackageManagers(tmpDir);
    expect(result.primary?.name).toBe('pip');
    expect(result.primary?.label).toContain('default');
  });

  it('returns a recommendation string', async () => {
    fs.writeFileSync(path.join(tmpDir, 'uv.lock'), '');
    const result = await detectPythonPackageManagers(tmpDir);
    expect(result.recommendation).toContain('uv');
    expect(result.recommendation).toContain('uv add');
  });
});

// ---------------------------------------------------------------------------
// Static helpers
// ---------------------------------------------------------------------------

describe('static package manager helpers', () => {
  it.each([
    { fn: composerPackageManager, name: 'composer' },
    { fn: swiftPackageManager, name: 'spm' },
    { fn: gradlePackageManager, name: 'gradle' },
  ])('$name returns valid PackageManagerInfo', async ({ fn }) => {
    const result = await fn();
    expect(result.detected).toHaveLength(1);
    expect(result.primary).toBe(result.detected[0]);
    expect(result.primary?.name).toBeTruthy();
    expect(result.primary?.installCommand).toBeTruthy();
    expect(result.recommendation).toBeTruthy();
  });
});
