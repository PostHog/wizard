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
import {
  applyDetectionReport,
  getProjects,
  getTraitClaims,
  getTraits,
  runDiscovery,
  selectProjects,
  setTrait,
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
