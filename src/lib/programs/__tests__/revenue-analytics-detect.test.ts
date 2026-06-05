import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectRevenuePrerequisites } from '@lib/programs/revenue-analytics/index';
import { buildSession } from '@lib/wizard-session';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rev-detect-'));
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

describe('detectRevenuePrerequisites', () => {
  let tmpDir: string;
  let ctx: Record<string, unknown>;
  let setCtx: jest.Mock;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    ctx = {};
    setCtx = jest.fn((key: string, value: unknown) => {
      ctx[key] = value;
    });
  });
  afterEach(() => cleanup(tmpDir));

  it('errors when install directory is invalid', () => {
    const session = buildSession({ installDir: '/nonexistent/path' });
    detectRevenuePrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual(
      expect.objectContaining({ kind: 'bad-directory' }),
    );
  });

  it('errors when no package.json exists', () => {
    const session = buildSession({ installDir: tmpDir });
    detectRevenuePrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual({ kind: 'no-package-json' });
  });

  it('errors when only one of PostHog/Stripe is found', () => {
    writePackageJson(tmpDir, { stripe: '13.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectRevenuePrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual(
      expect.objectContaining({
        kind: 'missing-posthog',
        foundStripe: ['stripe'],
      }),
    );
  });

  it('succeeds when both PostHog and Stripe SDKs are present', () => {
    writePackageJson(tmpDir, { 'posthog-js': '1.0.0', stripe: '13.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectRevenuePrerequisites(session, setCtx);

    expect(ctx.detectError).toBeUndefined();
    expect(ctx.detectedPosthogSdks).toEqual(['posthog-js']);
    expect(ctx.detectedStripeSdks).toEqual(['stripe']);
  });

  it('aggregates SDKs across monorepo packages', () => {
    writePackageJson(tmpDir, { 'posthog-js': '1.0.0' });

    const subDir = path.join(tmpDir, 'packages', 'api');
    fs.mkdirSync(subDir, { recursive: true });
    writePackageJson(subDir, { stripe: '13.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectRevenuePrerequisites(session, setCtx);

    expect(ctx.detectError).toBeUndefined();
    expect(ctx.detectedPosthogSdks).toContain('posthog-js');
    expect(ctx.detectedStripeSdks).toContain('stripe');
  });
});
