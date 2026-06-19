import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectSelfDrivingPrerequisites,
  selfDrivingConfig,
  SELF_DRIVING_ABORT_CASES,
} from '@lib/programs/self-driving/index';
import { SETUP_REPORT_FILE } from '@lib/programs/posthog-integration/index';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import { buildSession } from '@lib/wizard-session';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pa-detect-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('detectSelfDrivingPrerequisites', () => {
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
    detectSelfDrivingPrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual(
      expect.objectContaining({ kind: 'bad-directory' }),
    );
  });

  it('errors when the PostHog setup report is missing', () => {
    const session = buildSession({ installDir: tmpDir });
    detectSelfDrivingPrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual({
      kind: 'no-setup-report',
      reportFile: SETUP_REPORT_FILE,
    });
  });

  it('succeeds when the PostHog setup report exists', () => {
    fs.writeFileSync(path.join(tmpDir, SETUP_REPORT_FILE), '# PostHog setup');

    const session = buildSession({ installDir: tmpDir });
    detectSelfDrivingPrerequisites(session, setCtx);

    expect(ctx.detectError).toBeUndefined();
    expect(ctx.setupReportFound).toBe(true);
  });
});

describe('SELF_DRIVING_ABORT_CASES', () => {
  const reasons = [
    'self-driving is not available for this project',
    'github connection declined',
    'ai data processing approval declined',
    'requires-interactive-mode',
    'requirements-incomplete',
  ];

  it.each(reasons)('matches the "%s" abort reason exactly once', (reason) => {
    const matched = SELF_DRIVING_ABORT_CASES.filter((c) =>
      c.match.test(reason),
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].message).toBeTruthy();
    expect(matched[0].body).toBeTruthy();
  });
});

describe('selfDrivingConfig', () => {
  it('keeps wizard_ask enabled — the flow is interview-driven', () => {
    expect(selfDrivingConfig.disallowedTools ?? []).not.toContain(
      WIZARD_TOOL_NAMES.wizardAsk,
    );
  });

  it('wires the self-driving-setup skill and CLI command', () => {
    expect(selfDrivingConfig.command).toBe('self-driving');
    expect(selfDrivingConfig.skillId).toBe('self-driving-setup');
    expect(selfDrivingConfig.id).toBe('self-driving');
    expect(selfDrivingConfig.requires).toContain('posthog-integration');
  });

  it('has no keep-skills step — the setup skill is removed in postRun', () => {
    const stepIds = selfDrivingConfig.steps.map((s) => s.id);
    expect(stepIds).not.toContain('skills');
    expect(stepIds).toEqual([
      'detect',
      'intro',
      'health-check',
      'auth',
      'run',
      'outro',
    ]);
  });
});
