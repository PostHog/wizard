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

import { Integration } from '@shared/constants';
import { DiscoveredFeature } from '@shared/discovered-feature';
import {
  DETECTED_PROJECT_KEY,
  applyDetectionReport,
  detectedProjectOf,
  discoveredWarehouseSources,
  getProjects,
  getTools,
  getTraitClaims,
  getTraits,
  projectPathOf,
  runDiscovery,
  selectProjects,
  setTrait,
  settleProjects,
  unsettledTraits,
} from '@services/project-discovery';
import { SessionStore } from '@services/session/session-store';
import { buildSession } from '@services/session/wizard-session';

let repo: string;

function write(file: string, content = ''): void {
  const full = path.join(repo, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const pkg = (deps: Record<string, string> = {}): string =>
  JSON.stringify({ dependencies: deps });

/** A pnpm monorepo: a Next.js app with Stripe, an app that has PostHog, a library and a lint preset. */
async function discoveredMonorepo(): Promise<SessionStore> {
  write('package.json', pkg());
  write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - packages/*\n');
  write('apps/web/package.json', pkg({ next: '15.0.0', stripe: '^14.0.0' }));
  write('apps/web/app/layout.tsx');
  write(
    'apps/docs/package.json',
    pkg({ vue: '^3.4.0', 'posthog-js': '^1.0.0', openai: '^4.0.0' }),
  );
  write('packages/ui/package.json', pkg());
  write('packages/eslint-config/package.json', pkg());
  const store = new SessionStore(buildSession({ installDir: repo }));
  await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
  return store;
}

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traits-')));
});

afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('static detection in each project', () => {
  it('reads every project, not only the run project', async () => {
    const { session } = await discoveredMonorepo();
    expect(getTraits(session, 'apps/web')).toEqual({
      framework: Integration.nextjs,
      frameworkVariant: 'app-router',
      warehouseSources: ['Stripe'],
      posthogInstalled: 'no',
      installedSdks: ['stripe'],
      projectRole: 'app',
      workspaceRoot: '.',
      webFrontend: 'yes',
    });
    expect(getTraits(session, 'apps/docs')).toMatchObject({
      framework: Integration.vue,
      callsLlmApi: 'yes',
      posthogInstalled: 'yes',
      installedSdks: ['posthog'],
      webFrontend: 'yes',
    });
    // A language fallback matches any package, so it alone makes no app.
    expect(getTraits(session, 'packages/ui')).toEqual({
      framework: Integration.javascriptNode,
      posthogInstalled: 'no',
      projectRole: 'library',
      workspaceRoot: '.',
    });
    expect(getTraits(session, 'packages/eslint-config').projectRole).toBe(
      'tooling',
    );
    // The root is its own workspace root.
    expect(getTraits(session, '.').workspaceRoot).toBe('.');
  });

  it("reads a step scoped to another project from that project's own detection", async () => {
    const { session } = await discoveredMonorepo();
    // The run started at the root, where the program's detection found an LLM SDK.
    const live = { ...session, discoveredFeatures: [DiscoveredFeature.LLM] };
    expect(getTraits(live, '.').callsLlmApi).toBe('yes');
    const scoped = {
      ...live,
      runProject: 'apps/web',
      frameworkContext: {
        ...live.frameworkContext,
        [DETECTED_PROJECT_KEY]: detectedProjectOf(live),
      },
    };
    expect(getTraits(scoped)).toMatchObject({
      framework: Integration.nextjs,
      frameworkVariant: 'app-router',
    });
    expect(getTraits(scoped).callsLlmApi).toBeUndefined();
    // The root still reads its own detection through the scoped copy.
    expect(getTraits(scoped, '.').callsLlmApi).toBe('yes');
  });

  it.skipIf(process.platform === 'win32')(
    'names a folder reached through a link by its real path',
    async () => {
      const { session } = await discoveredMonorepo();
      const link = `${repo}-link`;
      fs.symlinkSync(repo, link);
      try {
        expect(projectPathOf(session, path.join(link, 'apps/web'))).toBe(
          'apps/web',
        );
      } finally {
        fs.unlinkSync(link);
      }
    },
  );

  it('gives each project that shares a package the tool', async () => {
    write('apps/api/package.json', pkg({ express: '^4.0.0', stripe: '^14' }));
    const { session } = await discoveredMonorepo();
    expect(getTraits(session, 'apps/web').warehouseSources).toEqual(['Stripe']);
    expect(getTraits(session, 'apps/api').warehouseSources).toEqual(['Stripe']);
    expect(getTraits(session, 'apps/docs').warehouseSources).toEqual([
      'OpenAI',
    ]);
    expect(getTraits(session, 'packages/ui').warehouseSources).toBeUndefined();
  });

  it('offers the run project its own tools and never a sibling project\u2019s', async () => {
    // A package below the app is the app's too.
    write('apps/docs/functions/package.json', pkg({ pg: '^8.0.0' }));
    const store = await discoveredMonorepo();
    const sourcesOf = async (runProject: string) => {
      store.setRunProject(runProject);
      const sources = await discoveredWarehouseSources(store.session);
      return sources.map((source) => source.kind).sort();
    };
    expect(await sourcesOf('apps/web')).toEqual(['Stripe']);
    expect(await sourcesOf('apps/docs')).toEqual(['OpenAI', 'Postgres']);
    expect(await sourcesOf('packages/ui')).toEqual([]);
    // The root holds every project.
    expect(await sourcesOf('.')).toEqual(['OpenAI', 'Postgres', 'Stripe']);
    expect(getTools(store.session, 'apps/web')).toEqual([
      expect.objectContaining({
        kind: 'Stripe',
        signals: [
          { source: 'npm', name: 'stripe', file: 'apps/web/package.json' },
        ],
      }),
    ]);
  });

  it('counts a PostHog SDK as installed, and never its CLI', async () => {
    write(
      'apps/cli-only/package.json',
      pkg({ next: '15', '@posthog/cli': '1' }),
    );
    const { session } = await discoveredMonorepo();
    expect(getTraits(session, 'apps/cli-only')).toMatchObject({
      posthogInstalled: 'no',
    });
    expect(getTraits(session, 'apps/cli-only').installedSdks).toBeUndefined();
    expect(getTraits(session, 'apps/docs').posthogInstalled).toBe('yes');
  });

  it('still knows the first run project once the run moves to another', async () => {
    const store = await discoveredMonorepo();
    await store.edit((draft) => {
      draft.integration = Integration.django;
      draft.mcpServerCandidates = ['server.py'];
    });
    settleProjects(store.readyContext());

    // What a move to another project does: the session now holds that one's detection.
    store.setRunProject('apps/web');
    await store.edit((draft) => {
      draft.integration = Integration.nextjs;
      draft.mcpServerCandidates = [];
    });
    expect(getTraits(store.session, '.')).toMatchObject({
      framework: Integration.django,
      mcpServers: ['server.py'],
    });
    expect(getTraits(store.session, 'apps/web').framework).toBe(
      Integration.nextjs,
    );
  });

  it('selects projects on their settled traits', async () => {
    const { session } = await discoveredMonorepo();
    const offered = selectProjects(
      session,
      (traits) =>
        traits.projectRole === 'app' &&
        traits.framework !== undefined &&
        traits.posthogInstalled !== 'yes',
    );
    expect(offered.map((project) => project.path)).toEqual(['apps/web']);
  });
});

describe('settling', () => {
  it('settles a trait its sources agree on', async () => {
    const store = await discoveredMonorepo();
    const sink = store.readyContext();
    setTrait(sink, 'apps/web', 'framework', Integration.nextjs, 'agentic');
    expect(getTraits(store.session, 'apps/web').framework).toBe(
      Integration.nextjs,
    );
    expect(unsettledTraits(store.session, 'apps/web')).toEqual([]);
    expect(getTraitClaims(store.session, 'apps/web').framework).toEqual([
      { value: Integration.nextjs, source: 'static' },
      { value: Integration.nextjs, source: 'agentic' },
    ]);
  });

  it('reads the fallback source and reports the trait unsettled when sources disagree', async () => {
    const store = await discoveredMonorepo();
    const sink = store.readyContext();
    setTrait(sink, 'apps/web', 'framework', Integration.vue, 'decisions', 0.7);
    // Static detection is what today's code reads for the framework.
    expect(getTraits(store.session, 'apps/web').framework).toBe(
      Integration.nextjs,
    );
    expect(unsettledTraits(store.session, 'apps/web')).toEqual(['framework']);
    expect(
      store.session.projects.find((p) => p.path === 'apps/web'),
    ).toMatchObject({
      traits: { framework: Integration.nextjs },
      unsettled: ['framework'],
      claims: {
        framework: [
          { value: Integration.vue, source: 'decisions', confidence: 0.7 },
        ],
      },
    });
  });

  it('lets the person settle a trait its sources disagree on', async () => {
    const store = await discoveredMonorepo();
    const sink = store.readyContext();
    setTrait(sink, 'apps/web', 'framework', Integration.vue, 'decisions');
    setTrait(sink, 'apps/web', 'framework', Integration.vue, 'person');
    expect(getTraits(store.session, 'apps/web').framework).toBe(
      Integration.vue,
    );
    expect(unsettledTraits(store.session, 'apps/web')).toEqual([]);
  });

  it('reads agentic detection for the main app, else Decisions', async () => {
    const store = await discoveredMonorepo();
    const sink = store.readyContext();
    setTrait(sink, 'apps/docs', 'mainApp', 'yes', 'decisions');
    expect(getTraits(store.session, 'apps/docs').mainApp).toBe('yes');
    expect(getTraits(store.session, 'apps/web').mainApp).toBeUndefined();
  });
});

describe('applyDetectionReport', () => {
  it('writes a report as traits and adds the projects static detection missed', async () => {
    const store = await discoveredMonorepo();
    applyDetectionReport(
      store.readyContext(),
      {
        repoType: 'monorepo',
        projects: [
          {
            path: 'apps/web',
            framework: 'Next.js',
            targetId: 'nextjs',
            hasPostHog: false,
            recommended: true,
          },
          {
            path: 'services/worker',
            framework: 'Django',
            targetId: 'django',
            hasPostHog: true,
          },
        ],
      },
      'agentic',
    );
    const { session } = store;
    expect(getTraits(session, 'apps/web')).toMatchObject({
      framework: Integration.nextjs,
      mainApp: 'yes',
      posthogInstalled: 'no',
    });
    expect(unsettledTraits(session, 'apps/web')).toEqual([]);
    expect(getTraits(session, 'services/worker')).toMatchObject({
      framework: Integration.django,
      posthogInstalled: 'yes',
    });
    expect(getProjects(session).map((project) => project.path)).toContain(
      'services/worker',
    );
  });

  it('keeps the same value for the run project when a source disagrees with static detection', async () => {
    write('package.json', pkg({ next: '15.0.0' }));
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    store.setFrameworkConfig(Integration.nextjs, null);
    const before = getTraits(store.session);

    applyDetectionReport(
      store.readyContext(),
      {
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework: 'Vue',
            targetId: 'vue',
            hasPostHog: true,
          },
        ],
      },
      'decisions',
      () => 0.55,
    );

    expect(getTraits(store.session)).toEqual(before);
    expect(unsettledTraits(store.session)).toEqual([
      'framework',
      'posthogInstalled',
    ]);
  });
});
