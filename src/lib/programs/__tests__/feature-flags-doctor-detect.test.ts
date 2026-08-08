import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectFeatureFlagsPrerequisites,
  featureFlagsDoctorConfig,
  FEATURE_FLAGS_ABORT_CASES,
} from '@lib/programs/feature-flags-doctor/index';
import { FEATURE_FLAGS_DOCTOR_SEED_CHECKS } from '@lib/programs/feature-flags-doctor/seed';
import { FEATURE_FLAGS_AREA_SLIDES } from '@ui/tui/screens/audit/slides/feature-flags/index';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import { buildSession } from '@lib/wizard-session';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ff-detect-'));
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

describe('detectFeatureFlagsPrerequisites', () => {
  let tmpDir: string;
  let ctx: Record<string, unknown>;
  let setCtx: Mock;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    ctx = {};
    setCtx = vi.fn((key: string, value: unknown) => {
      ctx[key] = value;
    });
  });
  afterEach(() => cleanup(tmpDir));

  it('errors when install directory is invalid', () => {
    const session = buildSession({ installDir: '/nonexistent/path' });
    detectFeatureFlagsPrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual(
      expect.objectContaining({ kind: 'bad-directory' }),
    );
  });

  it('errors when no package.json exists', () => {
    const session = buildSession({ installDir: tmpDir });
    detectFeatureFlagsPrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual({ kind: 'no-package-json' });
  });

  it('errors when no PostHog SDK is found', () => {
    writePackageJson(tmpDir, { react: '18.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectFeatureFlagsPrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual(
      expect.objectContaining({ kind: 'no-posthog' }),
    );
    expect(ctx.detectedPosthogSdks).toBeUndefined();
  });

  it('succeeds when a PostHog SDK is present', () => {
    writePackageJson(tmpDir, { 'posthog-js': '1.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectFeatureFlagsPrerequisites(session, setCtx);

    expect(ctx.detectError).toBeUndefined();
    expect(ctx.detectedPosthogSdks).toEqual(['posthog-js']);
  });
});

describe('FEATURE_FLAGS_ABORT_CASES', () => {
  const reasons = [
    'No feature flag usage',
    'Insufficient permissions',
    'PostHog SDK not installed',
  ];

  it.each(reasons)('matches the "%s" abort reason exactly once', (reason) => {
    const matched = FEATURE_FLAGS_ABORT_CASES.filter((c) =>
      c.match.test(reason),
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].message).toBeTruthy();
    expect(matched[0].body).toBeTruthy();
  });
});

describe('featureFlagsDoctorConfig', () => {
  it('keeps wizard_ask enabled so the user can pick which fixes to apply', () => {
    expect(featureFlagsDoctorConfig.disallowedTools ?? []).not.toContain(
      WIZARD_TOOL_NAMES.wizardAsk,
    );
  });

  it('wires the rebuilt audit-feature-flags skill and CLI command', () => {
    expect(featureFlagsDoctorConfig.command).toBe('feature-flags');
    expect(featureFlagsDoctorConfig.skillId).toBe('audit-feature-flags');
    expect(featureFlagsDoctorConfig.id).toBe('feature-flags-doctor');
    expect(featureFlagsDoctorConfig.parentCommand).toBe('audit');
  });

  it('routes run/intro/outro steps to the audit screens', () => {
    const byId = Object.fromEntries(
      featureFlagsDoctorConfig.steps.map((s) => [s.id, s.screenId]),
    );
    expect(byId.intro).toBe('audit-intro');
    expect(byId.run).toBe('audit-run');
    expect(byId.outro).toBe('audit-outro');
  });

  it('seeds a ledger with unique check ids including the workflow rows', () => {
    const ids = FEATURE_FLAGS_DOCTOR_SEED_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('apply-fixes');
    expect(ids).toContain('write-report');
    expect(
      FEATURE_FLAGS_DOCTOR_SEED_CHECKS.every((c) => c.status === 'pending'),
    ).toBe(true);
  });

  it('has a slide for every seeded check area', () => {
    const areas = new Set(FEATURE_FLAGS_DOCTOR_SEED_CHECKS.map((c) => c.area));
    const slideAreas = new Set(FEATURE_FLAGS_AREA_SLIDES.map((s) => s.area));
    for (const area of areas) {
      expect(slideAreas).toContain(area);
    }
  });

  it('keeps seed labels within the 40-char ledger budget', () => {
    for (const check of FEATURE_FLAGS_DOCTOR_SEED_CHECKS) {
      expect(check.label.length).toBeLessThanOrEqual(40);
    }
  });
});
