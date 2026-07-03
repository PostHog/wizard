import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectSelfDrivingPrerequisites,
  selfDrivingConfig,
  SELF_DRIVING_ABORT_CASES,
} from '@lib/programs/self-driving/index';
import { detectPostHogPresent } from '@lib/programs/self-driving/detect';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import { buildSession } from '@lib/wizard-session';
import type { Mock } from 'vitest';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'self-driving-detect-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('detectSelfDrivingPrerequisites', () => {
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
    detectSelfDrivingPrerequisites(session, setCtx);

    expect(ctx.detectError).toEqual(
      expect.objectContaining({ kind: 'bad-directory' }),
    );
  });

  it('proceeds for a valid directory even when the setup report is absent', () => {
    // The setup report is no longer a prerequisite — many users never commit
    // it — so a valid, readable install dir alone clears detection.
    const session = buildSession({ installDir: tmpDir });
    detectSelfDrivingPrerequisites(session, setCtx);

    expect(ctx.detectError).toBeUndefined();
  });
});

describe('SELF_DRIVING_ABORT_CASES', () => {
  const reasons = [
    'self-driving is not available for this project',
    'github connection declined',
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

  it('marks benign, user/environment-driven aborts as expected (kept out of error tracking)', () => {
    // Declining GitHub or running non-interactively are normal outcomes, not
    // exceptions worth triaging — they must be flagged `expected` so
    // wizardAbort skips captureException.
    const expectedReasons = [
      'github connection declined',
      'requires-interactive-mode',
      'requirements-incomplete',
    ];
    for (const reason of expectedReasons) {
      const [c] = SELF_DRIVING_ABORT_CASES.filter((c) => c.match.test(reason));
      expect(c?.expected, reason).toBe(true);
    }
  });

  it('keeps the unavailable-access abort as a genuine (unexpected) error', () => {
    // Signals being unreachable in open beta is a real failure — it should
    // still be reported to error tracking.
    const [c] = SELF_DRIVING_ABORT_CASES.filter((c) =>
      c.match.test('self-driving is not available for this project'),
    );
    expect(c?.expected).not.toBe(true);
  });

  it('frames the unavailable-access abort as open beta, not a closed per-team beta', () => {
    // STEP 1 no longer gates on access — Self-driving is open beta — but the
    // abort is kept as a safety net. Its copy must say the product is still
    // in beta while dropping the old closed/per-team "join the beta" framing.
    const [accessCase] = SELF_DRIVING_ABORT_CASES.filter((c) =>
      c.match.test('self-driving is not available for this project'),
    );
    expect(accessCase).toBeDefined();
    const copy = `${accessCase.message} ${accessCase.body}`.toLowerCase();
    expect(copy).toContain('open beta');
    expect(copy).not.toContain('per team');
    expect(copy).not.toContain('join the beta');
  });
});

describe('selfDrivingConfig', () => {
  it('keeps wizard_ask enabled — the flow is interview-driven', () => {
    expect(selfDrivingConfig.disallowedTools ?? []).not.toContain(
      WIZARD_TOOL_NAMES.wizardAsk,
    );
  });

  it('shortens the Learn deck final pause so the Tips pane appears promptly', () => {
    const blocks = selfDrivingConfig.getContentBlocks?.() ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    const last = blocks[blocks.length - 1];
    expect(typeof last === 'object' ? last.pause : undefined).toBe(5000);
  });

  it('gives wizard_ask a 30-min timeout for the browser-handoff steps', async () => {
    // `run` is resolved per-session so the prompt can carry the integrate flag.
    const { run } = selfDrivingConfig;
    const resolved =
      typeof run === 'function' ? await run(buildSession({})) : run;
    expect(resolved?.askTimeoutMs).toBe(30 * 60 * 1000);
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
      'integration-check',
      'health-check',
      'auth',
      'integrate-detect',
      'integrate-run',
      'self-driving-handoff',
      'run',
      'outro',
    ]);
  });
});

describe('detectPostHogPresent', () => {
  it('returns true when a manifest declares a PostHog package', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ dependencies: { 'posthog-node': '^4.0.0' } }),
      );
      expect(detectPostHogPresent(dir)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('returns false when no manifest mentions PostHog', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ dependencies: { express: '^4.0.0' } }),
      );
      expect(detectPostHogPresent(dir)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  it('does not match "posthog" glued inside a larger package name', () => {
    // Only fires at a dependency boundary, so `posthog` glued inside another
    // package name isn't a false positive. (A bare word in prose still matches.)
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'requirements.txt'),
        'myposthogtool==1.0.0\n',
      );
      expect(detectPostHogPresent(dir)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  it('detects PostHog declared as a dependency across manifest formats', () => {
    const cases: Array<[string, string]> = [
      ['package.json', '{"dependencies":{"posthog-node":"^4.0.0"}}'],
      ['requirements.txt', 'flask==3.0\nposthog==3.7.0\n'],
      ['Gemfile', "source 'https://rubygems.org'\ngem 'posthog'\n"],
      ['go.mod', 'module x\nrequire github.com/posthog/posthog-go v1.2.0\n'],
      ['pubspec.yaml', 'dependencies:\n  posthog: ^4.0.0\n'],
    ];
    for (const [name, contents] of cases) {
      const dir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(dir, name), contents);
        expect(detectPostHogPresent(dir), name).toBe(true);
      } finally {
        cleanup(dir);
      }
    }
  });

  it('detects PostHog in a common sub-app dir (monorepo)', () => {
    const dir = makeTmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'frontend'));
      fs.writeFileSync(
        path.join(dir, 'frontend', 'package.json'),
        '{"dependencies":{"posthog-js":"^1.0.0"}}',
      );
      expect(detectPostHogPresent(dir)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('does not scan arbitrary nested dirs (no recursive walk)', () => {
    const dir = makeTmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'services', 'api'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'services', 'api', 'package.json'),
        '{"dependencies":{"posthog-node":"^4.0.0"}}',
      );
      expect(detectPostHogPresent(dir)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  it('returns false for an empty project', () => {
    const dir = makeTmpDir();
    try {
      expect(detectPostHogPresent(dir)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});
