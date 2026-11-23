import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/analytics', () => ({
  analytics: {
    captureException: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock(
  import('@services/warehouse-sources/registry'),
  async (importOriginal) =>
    (
      await import(
        '@services/warehouse-sources/__tests__/helpers/tool-catalog.no-jest'
      )
    ).withFixtureCatalog(await importOriginal()),
);

import { WIZARD_PROJECT_DISCOVERY_FLAG_KEY } from '@shared/constants';
import { analytics } from '@utils/analytics';
import {
  getDiscovery,
  rediscoverAfterLogin,
  runDiscovery,
} from '@services/project-discovery';
import { workspaceFingerprint } from '@services/project-discovery/fingerprint';
import { buildDiscoveryReport } from '@services/project-discovery/report';
import {
  discoverProjects,
  parentOf,
} from '@services/project-discovery/projects';
import {
  MAX_TREE_FILES,
  findWorkspaceRoot,
  walkRepo,
} from '@services/project-discovery/walk';
import { SessionStore } from '@services/session/session-store';
import { buildSession } from '@services/session/wizard-session';

let repo: string;

function write(file: string, content = ''): void {
  const full = path.join(repo, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const pkg = (deps: Record<string, string> = {}, extra: object = {}): string =>
  JSON.stringify({ dependencies: deps, ...extra });

/** A pnpm monorepo: two apps, a library and a package outside the workspace globs. */
function pnpmMonorepo(): void {
  fs.mkdirSync(path.join(repo, '.git'));
  write('package.json', pkg());
  write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - packages/*\n");
  write('turbo.json', '{}');
  write('apps/web/package.json', pkg({ next: '15.0.0', stripe: '^14.0.0' }));
  write('apps/web/app/page.tsx');
  write('apps/api/package.json', pkg({ express: '^4.0.0' }));
  write('packages/ui/package.json', pkg({ react: '^18.0.0' }));
  write('examples/demo/package.json', pkg());
}

const paths = (projects: readonly { path: string }[]): string[] =>
  projects.map((project) => project.path);

beforeEach(() => {
  // realpath: the lookup compares resolved paths, and macOS tmp is a symlink.
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'projects-')));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({});
});

describe('findWorkspaceRoot', () => {
  it('finds the workspace above a member the run started in', () => {
    pnpmMonorepo();
    expect(findWorkspaceRoot(path.join(repo, 'apps/web'))).toEqual({
      rootDir: repo,
      runProject: 'apps/web',
    });
  });

  it('keeps the run directory when no marker above holds it', () => {
    pnpmMonorepo();
    const outside = path.join(repo, 'examples/demo');
    expect(findWorkspaceRoot(outside)).toEqual({
      rootDir: outside,
      runProject: '.',
    });
  });

  it('stops at the git root', () => {
    pnpmMonorepo();
    const nested = path.join(repo, 'apps/web');
    fs.mkdirSync(path.join(nested, '.git'));
    expect(findWorkspaceRoot(nested)).toEqual({
      rootDir: nested,
      runProject: '.',
    });
  });

  it('keeps a single-app repo as its own root', () => {
    write('package.json', pkg({ next: '15.0.0' }));
    expect(findWorkspaceRoot(repo)).toEqual({ rootDir: repo, runProject: '.' });
  });

  it('starts in the member that holds a source folder the run started in', () => {
    pnpmMonorepo();
    expect(findWorkspaceRoot(path.join(repo, 'apps/web/app'))).toEqual({
      rootDir: repo,
      runProject: 'apps/web',
    });
  });

  it('keeps a workspace nested in another as its own root', () => {
    write('pnpm-workspace.yaml', "packages:\n  - '**'\n");
    write('package.json', pkg());
    write('tools/build/Cargo.toml', '[workspace]\nmembers = ["crates/*"]\n');
    write('tools/build/crates/cli/Cargo.toml', '[package]\nname = "cli"\n');
    const nested = path.join(repo, 'tools/build');
    expect(findWorkspaceRoot(nested)).toEqual({
      rootDir: nested,
      runProject: '.',
    });
  });

  it('reads a package turbo.json as configuration, not as a workspace root', () => {
    pnpmMonorepo();
    write('apps/web/turbo.json', '{ "extends": ["//"] }');
    expect(findWorkspaceRoot(path.join(repo, 'apps/web'))).toEqual({
      rootDir: repo,
      runProject: 'apps/web',
    });
  });

  it('never looks above the home directory', () => {
    write('turbo.json', '{}');
    write('home/package.json', pkg());
    const home = path.join(repo, 'home');
    // `os.homedir()` reads these.
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    expect(findWorkspaceRoot(home)).toEqual({ rootDir: home, runProject: '.' });
    vi.unstubAllEnvs();
  });

  it.skipIf(process.platform === 'win32')(
    'takes no root from a directory others can write',
    () => {
      write('turbo.json', '{}');
      write('app/package.json', pkg());
      fs.chmodSync(repo, 0o777);
      const app = path.join(repo, 'app');
      expect(findWorkspaceRoot(app)).toEqual({ rootDir: app, runProject: '.' });
    },
  );

  it('keeps the run where it started when a prompt cannot carry its path', () => {
    write('turbo.json', '{}');
    write('apps/we`b/package.json', pkg());
    const odd = path.join(repo, 'apps/we`b');
    expect(findWorkspaceRoot(odd)).toEqual({ rootDir: odd, runProject: '.' });
  });
});

describe('discoverProjects', () => {
  it('reads one project in a single-app repo', () => {
    write('package.json', pkg({ next: '15.0.0' }));
    expect(discoverProjects(walkRepo(repo))).toMatchObject({
      repoType: 'single',
      workspaces: [],
      projects: [{ path: '.', traits: {} }],
      complete: true,
    });
  });

  it('reads the members of a workspace and prunes what its globs leave out', () => {
    pnpmMonorepo();
    const found = discoverProjects(walkRepo(repo));
    expect(found.repoType).toBe('monorepo');
    expect(found.workspaceTool).toBe('turbo');
    expect(found.workspaces).toEqual([
      {
        root: '.',
        tool: 'turbo',
        members: ['apps/api', 'apps/web', 'packages/ui'],
      },
    ]);
    expect(paths(found.projects)).toEqual([
      '.',
      'apps/api',
      'apps/web',
      'packages/ui',
    ]);
    expect(parentOf('apps/web', found.projects)?.path).toBe('.');
  });

  it('keeps a JS app beside a Rust and Go workspace that does not name it', () => {
    write('Cargo.toml', '[workspace]\nmembers = ["crates/*"]\n');
    write('crates/core/Cargo.toml', '[package]\nname = "core"\n');
    write('tools/gen/Cargo.toml', '[package]\nname = "gen"\n');
    write('go.work', 'go 1.22\n\nuse ./services/api\n');
    write('services/api/go.mod', 'module example.com/api\n');
    write('web/package.json', pkg({ next: '15.0.0' }));
    const found = discoverProjects(walkRepo(repo));
    // The crate outside the globs is still pruned; the JS app is not the workspace's to prune.
    expect(paths(found.projects)).toEqual([
      '.',
      'web',
      'crates/core',
      'services/api',
    ]);
  });

  it('reads a pnpm-workspace.yaml that only holds settings as no workspace', () => {
    write('package.json', pkg({ next: '15.0.0' }));
    write('pnpm-workspace.yaml', 'onlyBuiltDependencies:\n  - esbuild\n');
    write('scripts/package.json', pkg());
    const found = discoverProjects(walkRepo(repo));
    expect(found.repoType).toBe('single');
    expect(found.workspaces).toEqual([]);
  });

  it.each([
    [
      'a brace set',
      "packages:\n  - 'apps/{web,api}'\n",
      ['.', 'apps/api', 'apps/web'],
    ],
    [
      'a huge brace range',
      "packages:\n  - '{1..100000}'\n  - apps/web\n",
      ['.', 'apps/web'],
    ],
    [
      'a long run of slashes',
      `packages:\n  - apps/web${'/'.repeat(100)}\n`,
      ['.', 'apps/web'],
    ],
    [
      'a glob over the length cap',
      `packages:\n  - apps/web${'/'.repeat(80_000)}\n  - apps/api\n`,
      ['.', 'apps/api'],
    ],
  ])('matches members through %s', (_label, workspace, expected) => {
    write('package.json', pkg());
    write('pnpm-workspace.yaml', workspace);
    write('apps/web/package.json', pkg());
    write('apps/api/package.json', pkg());
    expect(paths(discoverProjects(walkRepo(repo)).projects)).toEqual(expected);
  });

  it('keeps the run project even outside every workspace', () => {
    pnpmMonorepo();
    const found = discoverProjects(walkRepo(repo), 'examples/demo');
    expect(paths(found.projects)).toContain('examples/demo');
  });

  it('gives each workspace its own root in a repo with two', () => {
    write('package.json', pkg({}, { workspaces: ['web/*'] }));
    write('web/app/package.json', pkg());
    write('services/go.work', 'go 1.22\n\nuse (\n\t./api\n\t./worker\n)\n');
    write('services/api/go.mod', 'module example.com/api\n');
    write('services/worker/go.mod', 'module example.com/worker\n');
    expect(discoverProjects(walkRepo(repo)).workspaces).toEqual([
      { root: '.', tool: 'npm', members: ['web/app'] },
      {
        root: 'services',
        tool: 'go',
        members: ['services/api', 'services/worker'],
      },
    ]);
  });

  it('gives a project its real path however long it is', () => {
    const long = `apps/${'a'.repeat(60)}/${'b'.repeat(70)}`;
    write('package.json', pkg());
    write(`${long}/package.json`, pkg({ next: '15.0.0' }));
    const walk = walkRepo(repo);
    // The path shown is cut; the directory the project resolves to is not.
    expect(walk.manifests.map((m) => m.path)).toContain(
      `${long}/package.json`.slice(0, 120) + '…',
    );
    expect(paths(discoverProjects(walk).projects)).toEqual(['.', long]);
    expect(fs.existsSync(path.join(repo, long))).toBe(true);
  });

  it('lists no project whose folder name a prompt cannot carry', () => {
    write('package.json', pkg());
    write('apps/we`b/package.json', pkg({ stripe: '^14.0.0' }));
    write('apps/api/package.json', pkg());
    const walk = walkRepo(repo);
    // Its packages are still read for the tool match, under a cleaned path.
    expect(walk.manifests.map((m) => m.path)).toContain(
      'apps/we?b/package.json',
    );
    expect(paths(discoverProjects(walk).projects)).toEqual(['.', 'apps/api']);
  });

  it('reads a Gradle build with one module as one project, not a workspace', () => {
    write('settings.gradle', "include ':app'\n");
    write('build.gradle', '');
    write('app/build.gradle', '');
    expect(discoverProjects(walkRepo(repo)).repoType).toBe('single');
  });
});

describe('the walk budget', () => {
  it('spends the file cap on the run project first, then shares the rest', () => {
    pnpmMonorepo();
    for (let i = 0; i < MAX_TREE_FILES - 100; i += 1) {
      write(`apps/web/src/file-${i}.ts`);
    }
    for (let i = 0; i < 400; i += 1) write(`apps/api/src/file-${i}.ts`);
    for (let i = 0; i < 400; i += 1) write(`packages/ui/src/file-${i}.ts`);

    const walked = walkRepo(repo, { runProject: 'apps/web' });
    const under = (dir: string) =>
      walked.files.filter((file) => file.startsWith(`${dir}/`)).length;

    expect(walked.files).toHaveLength(MAX_TREE_FILES);
    expect(walked.truncated).toBe(true);
    // Every file of the run project, then a share for each other project.
    expect(under('apps/web')).toBe(MAX_TREE_FILES - 100 + 2);
    expect(under('apps/api')).toBeGreaterThan(0);
    expect(under('packages/ui')).toBeGreaterThan(0);
    // Manifests are read past the cap, so no project goes missing.
    const found = discoverProjects(walked, 'apps/web');
    expect(paths(found.projects)).toEqual([
      '.',
      'apps/api',
      'apps/web',
      'packages/ui',
    ]);
    expect(found.complete).toBe(false);
  });
});

describe('the walk bounds', () => {
  it('skips malformed manifests and sends no event', () => {
    write('package.json', pkg());
    for (const app of ['a', 'b', 'c']) write(`apps/${app}/package.json`, '{');
    vi.mocked(analytics.captureException).mockClear();
    const found = walkRepo(repo);
    expect(found.manifests.map((manifest) => manifest.path)).toEqual([
      'package.json',
    ]);
    expect(analytics.captureException).not.toHaveBeenCalled();
  });

  it('keeps a bounded number of files for one env key', () => {
    for (let i = 0; i < 30; i += 1) write(`.env.${i}`, 'DATABASE_URL=x\n');
    const [key] = walkRepo(repo).envKeys;
    expect(key.name).toBe('DATABASE_URL');
    expect(key.files).toHaveLength(20);
  });
});

describe('runDiscovery', () => {
  const discoverFrom = async (runDir: string) => {
    const store = new SessionStore(buildSession({ installDir: runDir }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    return store.session;
  };

  it('walks from the run directory while the flag is off', async () => {
    pnpmMonorepo();
    const runDir = path.join(repo, 'apps/web');
    const session = await discoverFrom(runDir);
    expect(getDiscovery(session)).toMatchObject({
      rootDir: runDir,
      runDir,
      runProject: '.',
      mode: 'off',
    });
    expect(session.runProject).toBe('.');
    expect(paths(session.projects)).toEqual(['.']);
  });

  it('walks from the workspace root once the flag is on', async () => {
    vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({
      [WIZARD_PROJECT_DISCOVERY_FLAG_KEY]: 'one-project',
    });
    pnpmMonorepo();
    const runDir = path.join(repo, 'apps/web');
    const session = await discoverFrom(runDir);
    const discovery = getDiscovery(session);
    expect(discovery).toMatchObject({
      rootDir: repo,
      runDir,
      runProject: 'apps/web',
      mode: 'one-project',
    });
    expect(discovery?.projects.repoType).toBe('monorepo');
    expect(session.runProject).toBe('apps/web');
    expect(paths(session.projects)).toEqual([
      '.',
      'apps/api',
      'apps/web',
      'packages/ui',
    ]);
    // The run project is walked first, so its manifest names the tool.
    expect(discovery?.tools.tools.map((tool) => tool.kind)).toContain('Stripe');
  });

  it('starts no framework detection once its budget has run out', async () => {
    vi.useFakeTimers();
    const framework = await import('@services/detection/framework');
    const pending: Array<() => void> = [];
    const detect = vi.spyOn(framework, 'detectFramework').mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(() => resolve(undefined));
        }),
    );
    try {
      vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({
        [WIZARD_PROJECT_DISCOVERY_FLAG_KEY]: 'one-project',
      });
      pnpmMonorepo();
      for (const app of ['a', 'b', 'c', 'd', 'e', 'f']) {
        write(`apps/${app}/package.json`, pkg());
      }
      const discovering = discoverFrom(path.join(repo, 'apps/web'));
      await vi.advanceTimersByTimeAsync(5_000);
      await discovering;
      // Nine other projects, and only the first four were started.
      expect(pending).toHaveLength(4);
      pending.forEach((finish) => finish());
      await vi.advanceTimersByTimeAsync(0);
      expect(detect).toHaveBeenCalledTimes(4);
    } finally {
      detect.mockRestore();
      vi.useRealTimers();
    }
  });

  it('discovers again when login changes what the flag answers', async () => {
    pnpmMonorepo();
    const runDir = path.join(repo, 'apps/web');
    const store = new SessionStore(buildSession({ installDir: runDir }));
    const program = { id: 'posthog-integration' };
    await runDiscovery(program, store.readyContext());
    expect(getDiscovery(store.session)).toMatchObject({ mode: 'off' });

    // Nothing changed: the first discovery stays.
    const first = getDiscovery(store.session);
    await rediscoverAfterLogin(program, store.readyContext());
    expect(getDiscovery(store.session)).toBe(first);

    vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({
      [WIZARD_PROJECT_DISCOVERY_FLAG_KEY]: 'one-project',
    });
    await rediscoverAfterLogin(program, store.readyContext());
    expect(getDiscovery(store.session)).toMatchObject({
      mode: 'one-project',
      rootDir: repo,
      runDir,
      runProject: 'apps/web',
    });
    expect(store.session.runProject).toBe('apps/web');
    expect(paths(store.session.projects)).toContain('apps/api');
  });

  it('reports only the tools of the project the run started in', async () => {
    vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({
      [WIZARD_PROJECT_DISCOVERY_FLAG_KEY]: 'one-project',
    });
    pnpmMonorepo();
    const reportFrom = async (runDir: string) => {
      const discovery = getDiscovery(await discoverFrom(runDir));
      if (!discovery) throw new Error('no discovery');
      // The whole workspace is matched; only the report is narrowed.
      expect(discovery.tools.tools.map((tool) => tool.kind)).toContain(
        'Stripe',
      );
      return buildDiscoveryReport(discovery, 7);
    };

    const api = await reportFrom(path.join(repo, 'apps/api'));
    expect(api.tools).toEqual([]);
    expect(api.workspace_fingerprint).toBe(
      workspaceFingerprint(7, path.join(repo, 'apps/api')),
    );

    // A run started below a project reports that project's tools under the folder it started in.
    const below = await reportFrom(path.join(repo, 'apps/web/app'));
    expect(below.tools.map((tool) => tool.kind)).toEqual(['Stripe']);
    expect(below.workspace_fingerprint).toBe(
      workspaceFingerprint(7, path.join(repo, 'apps/web/app')),
    );

    const web = await reportFrom(path.join(repo, 'apps/web'));
    expect(web.tools).toEqual([
      expect.objectContaining({
        kind: 'Stripe',
        signals: [
          { source: 'npm', name: 'stripe', file: 'apps/web/package.json' },
        ],
      }),
    ]);
  });

  it('finds the projects when the tool catalog is missing', async () => {
    const registry = await import('@services/warehouse-sources/registry');
    vi.mocked(registry.loadSourceDetectors).mockResolvedValueOnce([]);
    pnpmMonorepo();
    const session = await discoverFrom(repo);
    const discovery = getDiscovery(session);
    expect(discovery?.tools).toMatchObject({ failed: true });
    expect(discovery?.projects.repoType).toBe('monorepo');
    expect(paths(session.projects)).toHaveLength(4);
  });
});
