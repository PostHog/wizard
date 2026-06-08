import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectWebAnalyticsPrerequisites,
  webAnalyticsDoctorConfig,
  WEB_ANALYTICS_ABORT_CASES,
} from '@lib/programs/web-analytics-doctor/index';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import { buildSession } from '@lib/wizard-session';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wa-detect-'));
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

describe('detectWebAnalyticsPrerequisites', () => {
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
    detectWebAnalyticsPrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual(
      expect.objectContaining({ kind: 'bad-directory' }),
    );
  });

  it('errors when no package.json exists', () => {
    const session = buildSession({ installDir: tmpDir });
    detectWebAnalyticsPrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual({ kind: 'no-package-json' });
  });

  it('errors when no PostHog SDK is found', () => {
    writePackageJson(tmpDir, { react: '18.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectWebAnalyticsPrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual(
      expect.objectContaining({ kind: 'no-posthog' }),
    );
    expect(ctx.detectedPosthogSdks).toBeUndefined();
  });

  it('succeeds when a PostHog SDK is present', () => {
    writePackageJson(tmpDir, { 'posthog-js': '1.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectWebAnalyticsPrerequisites(session, setCtx);

    expect(ctx.detectError).toBeUndefined();
    expect(ctx.detectedPosthogSdks).toEqual(['posthog-js']);
  });

  it('finds a PostHog SDK in a monorepo subpackage', () => {
    writePackageJson(tmpDir, { react: '18.0.0' });

    const subDir = path.join(tmpDir, 'packages', 'web');
    fs.mkdirSync(subDir, { recursive: true });
    writePackageJson(subDir, { 'posthog-js': '1.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectWebAnalyticsPrerequisites(session, setCtx);

    expect(ctx.detectError).toBeUndefined();
    expect(ctx.detectedPosthogSdks).toContain('posthog-js');
  });
});

describe('WEB_ANALYTICS_ABORT_CASES', () => {
  const reasons = [
    'No web analytics events',
    'Insufficient permissions',
    'PostHog SDK not installed',
  ];

  it.each(reasons)('matches the "%s" abort reason exactly once', (reason) => {
    const matched = WEB_ANALYTICS_ABORT_CASES.filter((c) =>
      c.match.test(reason),
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].message).toBeTruthy();
    expect(matched[0].body).toBeTruthy();
  });
});

describe('webAnalyticsDoctorConfig', () => {
  it('keeps wizard_ask enabled so the user can pick which fixes to apply', () => {
    expect(webAnalyticsDoctorConfig.disallowedTools ?? []).not.toContain(
      WIZARD_TOOL_NAMES.wizardAsk,
    );
  });

  it('wires the web-analytics-doctor skill and CLI command', () => {
    expect(webAnalyticsDoctorConfig.command).toBe('web-analytics');
    expect(webAnalyticsDoctorConfig.skillId).toBe('web-analytics-doctor');
    expect(webAnalyticsDoctorConfig.id).toBe('web-analytics-doctor');
  });
});
