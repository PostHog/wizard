import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectSelfDrivingPrerequisites,
  selfDrivingConfig,
  SELF_DRIVING_ABORT_CASES,
} from '@lib/programs/self-driving/index';
import {
  detectPostHogPresent,
  POSTHOG_MANIFESTS,
} from '@lib/programs/self-driving/detect';
import { toIntegrationReport } from '@lib/programs/self-driving/detect-agentic';
import {
  PROJECT_MANIFESTS,
  type AgenticDetectionReport,
} from '@lib/detection/agentic';
import { Integration } from '@lib/constants';
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

  it('ships its own Learn deck ending on the self-driving closer', () => {
    const blocks = selfDrivingConfig.getContentBlocks?.() ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    const last = blocks[blocks.length - 1];
    expect(
      typeof last === 'object' && 'content' in last ? last.content : '',
    ).toBe('Your product drives itself.');
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

  it('detects a scoped @posthog/* package as the only PostHog dependency', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ dependencies: { '@posthog/ai': '^8.0.0' } }),
      );
      expect(detectPostHogPresent(dir)).toBe(true);
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

  it('walks monorepo sub-apps but stays bounded (not a full recursive walk)', () => {
    const dir = makeTmpDir();
    try {
      // Depth 2 (services/api) IS scanned — that's the shallow-walk fix.
      fs.mkdirSync(path.join(dir, 'services', 'api'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'services', 'api', 'package.json'),
        '{"dependencies":{"posthog-node":"^4.0.0"}}',
      );
      expect(detectPostHogPresent(dir)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('does not walk past the bounded depth', () => {
    const dir = makeTmpDir();
    try {
      // Depth 3 (services/api/internal) is past WALK_MAX_DEPTH — not scanned.
      fs.mkdirSync(path.join(dir, 'services', 'api', 'internal'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(dir, 'services', 'api', 'internal', 'package.json'),
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

  it('detects PostHog across mobile / native manifest formats', () => {
    const cases: Array<[string, string]> = [
      // Apple: SPM, CocoaPods (+ lockfile), XcodeGen spec.
      [
        'Package.swift',
        '.package(url: "https://github.com/PostHog/posthog-ios.git", from: "3.0.0")',
      ],
      ['Podfile', "target 'App' do\n  pod 'PostHog'\nend\n"],
      ['Podfile.lock', 'PODS:\n  - PostHog (3.7.0)\n'],
      [
        'project.yml',
        'name: App\npackages:\n  PostHog:\n    url: https://github.com/PostHog/posthog-ios\n    from: 3.0.0\n',
      ],
      // Gradle coordinate (":" boundary) + version catalog.
      [
        'build.gradle',
        "dependencies {\n  implementation 'com.posthog:posthog-android:3.+'\n}\n",
      ],
      [
        'gradle/libs.versions.toml',
        '[libraries]\nposthog = { module = "com.posthog:posthog-android", version = "3.0" }\n',
      ],
      // Maven, Elixir, Rust, legacy Python.
      [
        'pom.xml',
        '<dependency><groupId>com.posthog.java</groupId><artifactId>posthog</artifactId></dependency>',
      ],
      ['mix.exs', 'defp deps do\n  [{:posthog, "~> 1.0"}]\nend\n'],
      ['Cargo.toml', '[dependencies]\nposthog-rs = "0.3"\n'],
      ['setup.py', 'setup(install_requires=["posthog>=3.0"])\n'],
    ];
    for (const [name, contents] of cases) {
      const dir = makeTmpDir();
      try {
        const file = path.join(dir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents);
        expect(detectPostHogPresent(dir), name).toBe(true);
      } finally {
        cleanup(dir);
      }
    }
  });

  it('detects PostHog in a .NET project via csproj PackageReference', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'MyApp.csproj'),
        '<ItemGroup><PackageReference Include="PostHog" Version="1.0.0" /></ItemGroup>',
      );
      expect(detectPostHogPresent(dir)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('detects PostHog in a plain Xcode project via project.pbxproj', () => {
    const dir = makeTmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'MyApp.xcodeproj'));
      fs.writeFileSync(
        path.join(dir, 'MyApp.xcodeproj', 'project.pbxproj'),
        'repositoryURL = "https://github.com/PostHog/posthog-ios";\n',
      );
      expect(detectPostHogPresent(dir)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('returns false for an Xcode project without PostHog', () => {
    const dir = makeTmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'MyApp.xcodeproj'));
      fs.writeFileSync(
        path.join(dir, 'MyApp.xcodeproj', 'project.pbxproj'),
        'repositoryURL = "https://github.com/apple/swift-argument-parser";\n',
      );
      expect(detectPostHogPresent(dir)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  it('detects PostHog in an ios/ sub-app dir', () => {
    const dir = makeTmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'ios'));
      fs.writeFileSync(
        path.join(dir, 'ios', 'Podfile'),
        "target 'App' do\n  pod 'PostHog'\nend\n",
      );
      expect(detectPostHogPresent(dir)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('detects PostHog nested in a monorepo sub-app off the named-dir allowlist', () => {
    // The iOS app lives at apps/mobile — not one of POSTHOG_DIRS. The shallow
    // walk reaches it; the old hardcoded-dir check would miss it entirely.
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ private: true, workspaces: ['apps/*'] }),
      );
      const app = path.join(dir, 'apps', 'mobile');
      fs.mkdirSync(app, { recursive: true });
      fs.writeFileSync(
        path.join(app, 'Podfile'),
        "target 'HogHollow' do\n  pod 'PostHog'\nend\n",
      );
      expect(detectPostHogPresent(dir)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('detects PostHog via a nested .xcodeproj in a monorepo sub-app', () => {
    const dir = makeTmpDir();
    try {
      const app = path.join(dir, 'apps', 'mobile', 'HogHollow.xcodeproj');
      fs.mkdirSync(app, { recursive: true });
      fs.writeFileSync(
        path.join(app, 'project.pbxproj'),
        'repositoryURL = "https://github.com/PostHog/posthog-ios";\n',
      );
      expect(detectPostHogPresent(dir)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('does NOT false-positive on a vendored posthog inside node_modules', () => {
    // The walk skips node_modules; a bundled posthog dependency there must not
    // read as the project having installed PostHog itself.
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ dependencies: { express: '^4.0.0' } }),
      );
      const vendored = path.join(dir, 'node_modules', 'posthog-js');
      fs.mkdirSync(vendored, { recursive: true });
      fs.writeFileSync(
        path.join(vendored, 'package.json'),
        JSON.stringify({ name: 'posthog-js', version: '1.0.0' }),
      );
      expect(detectPostHogPresent(dir)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  it('returns false for a monorepo with no PostHog in any sub-app', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ private: true, workspaces: ['apps/*'] }),
      );
      const web = path.join(dir, 'apps', 'web');
      fs.mkdirSync(web, { recursive: true });
      fs.writeFileSync(
        path.join(web, 'package.json'),
        JSON.stringify({ dependencies: { next: '15.0.0' } }),
      );
      expect(detectPostHogPresent(dir)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});

describe('integrate-detect step', () => {
  const step = selfDrivingConfig.steps.find((s) => s.id === 'integrate-detect');

  it('is incomplete while integrating and no project picked yet', () => {
    const session = buildSession({});
    session.integrate = true;
    session.integration = null;
    expect(step?.isComplete?.(session)).toBe(false);
  });

  it('is complete once a project is picked to integrate', () => {
    const session = buildSession({});
    session.integrate = true;
    session.integration = Integration.nextjs;
    expect(step?.isComplete?.(session)).toBe(true);
  });

  it('is complete once the user continues with an existing install', () => {
    // integrate=false must complete the step or the orchestrator hangs.
    const session = buildSession({});
    session.integrate = false;
    session.integration = null;
    expect(step?.isComplete?.(session)).toBe(true);
  });
});

describe('toIntegrationReport', () => {
  const build = (
    p: Partial<AgenticDetectionReport['projects'][number]>,
  ): AgenticDetectionReport => ({
    repoType: 'single',
    projects: [
      { path: '.', framework: 'App', targetId: null, hasPostHog: false, ...p },
    ],
  });

  it('marks a supported project that already has PostHog as continuable, not instrumentable', () => {
    const [p] = toIntegrationReport(
      build({ targetId: Integration.nextjs, hasPostHog: true }),
    ).projects;
    expect(p.instrumentable).toBe(false);
    expect(p.continuable).toBe(true);
  });

  it('marks an unsupported project that already has PostHog as continuable', () => {
    // Self-driving needs PostHog present, not a wizard-supported framework.
    const [p] = toIntegrationReport(
      build({ targetId: null, hasPostHog: true }),
    ).projects;
    expect(p.continuable).toBe(true);
    expect(p.instrumentable).toBe(false);
  });

  it('marks a supported project without PostHog as instrumentable, not continuable', () => {
    const [p] = toIntegrationReport(
      build({ targetId: Integration.nextjs, hasPostHog: false }),
    ).projects;
    expect(p.instrumentable).toBe(true);
    expect(p.continuable).toBe(false);
  });

  it('marks an unsupported project without PostHog as neither', () => {
    const [p] = toIntegrationReport(
      build({ targetId: null, hasPostHog: false }),
    ).projects;
    expect(p.instrumentable).toBe(false);
    expect(p.continuable).toBe(false);
  });
});

describe('manifest list sync', () => {
  it('keeps the shared ecosystem manifests in both detection layers', () => {
    // POSTHOG_MANIFESTS (deterministic grep) and PROJECT_MANIFESTS (Haiku
    // root discovery) serve different jobs but must both know each shipped
    // ecosystem — a drift here caused a real gap during review.
    const shared = [
      'package.json',
      'requirements.txt',
      'Gemfile',
      'composer.json',
      'go.mod',
      'pubspec.yaml',
      'Package.swift',
      'Podfile',
      'project.yml',
      'build.gradle',
      'build.gradle.kts',
      'gradle/libs.versions.toml',
      'pom.xml',
      'mix.exs',
      'Cargo.toml',
    ];
    for (const name of shared) {
      expect(POSTHOG_MANIFESTS, `deterministic list: ${name}`).toContain(name);
      expect(PROJECT_MANIFESTS, `haiku list: ${name}`).toContain(name);
    }
  });
});

describe('integrate-run targetDir', () => {
  const targetDir = selfDrivingConfig.steps.find(
    (s) => s.id === 'integrate-run',
  )?.targetDir;

  const dirFor = (picked: string): string | undefined => {
    const session = buildSession({ installDir: '/repo' });
    session.frameworkContext.selfDrivingIntegratePath = picked;
    return typeof targetDir === 'function' ? targetDir(session) : targetDir;
  };

  it('scopes to the picked sub-app inside the repo', () => {
    expect(dirFor('apps/web')).toBe('/repo/apps/web');
    expect(dirFor('.')).toBe('/repo');
  });

  it('falls back to the repo root when the picked path escapes it', () => {
    // Defense-in-depth: the path is LLM output; coerceAgenticReport clamps
    // it, but the resolver must not trust the session value either.
    expect(dirFor('../../etc')).toBe('/repo');
    expect(dirFor('/etc')).toBe('/repo');
    expect(dirFor('a/../..')).toBe('/repo');
  });
});
