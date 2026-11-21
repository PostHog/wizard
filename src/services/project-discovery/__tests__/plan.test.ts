import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/analytics', () => ({
  analytics: {
    captureException: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    getAllFlagsForWizard: vi.fn(),
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

import {
  Integration,
  WIZARD_PROJECT_DISCOVERY_FLAG_KEY,
} from '@shared/constants';
import { analytics } from '@utils/analytics';
import type { ProgramConfig } from '@programs/program-contract';
import {
  buildPlan,
  pickLeavesRunProject,
  planNeedsPick,
  reportProjectsDiscovered,
  reportProjectsSelected,
  runDiscovery,
  setTrait,
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

/** posthog-integration's rule: an app with a framework that PostHog is not in yet. */
const PROGRAM: Pick<ProgramConfig, 'appliesTo'> = {
  appliesTo: (traits) =>
    traits.projectRole === 'app' &&
    traits.framework !== undefined &&
    traits.posthogInstalled !== 'yes',
};

/** A pnpm monorepo with two apps to offer, one that has PostHog, and a library. */
async function discovered(
  runFrom = '.',
  args: { ci?: boolean } = {},
): Promise<SessionStore> {
  fs.mkdirSync(path.join(repo, '.git'));
  write('package.json', pkg());
  write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - packages/*\n');
  write('apps/web/package.json', pkg({ next: '15.0.0' }));
  write('apps/admin/package.json', pkg({ vue: '^3.4.0' }));
  write('apps/docs/package.json', pkg({ vue: '^3.4.0', 'posthog-js': '^1' }));
  write('packages/ui/package.json', pkg());
  const store = new SessionStore(
    buildSession({ installDir: path.join(repo, runFrom), ...args }),
  );
  await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
  return store;
}

const row = (plan: ReturnType<typeof buildPlan>, projectPath: string) =>
  plan.projects.find((project) => project.path === projectPath);

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-')));
  vi.mocked(analytics.wizardCapture).mockClear();
  vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({
    [WIZARD_PROJECT_DISCOVERY_FLAG_KEY]: 'one-project',
  });
});

afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('buildPlan', () => {
  it('offers the apps and gives a reason for every other project', async () => {
    const { session } = await discovered();
    const plan = buildPlan(session, PROGRAM);
    expect(plan.repoType).toBe('monorepo');
    expect(row(plan, 'apps/web')).toMatchObject({
      offered: true,
      frameworkName: 'Next.js',
    });
    expect(row(plan, 'apps/admin')?.offered).toBe(true);
    expect(row(plan, 'apps/docs')).toMatchObject({
      offered: false,
      reason: 'has-posthog',
    });
    expect(row(plan, 'packages/ui')).toMatchObject({
      offered: false,
      reason: 'library',
    });
    // The root only holds the apps, so the run starting there does not offer it.
    expect(row(plan, '.')).toMatchObject({
      offered: false,
      reason: 'workspace-root',
    });
    expect(planNeedsPick(plan)).toBe(true);
  });

  it('asks nothing at a workspace root that holds one app, and takes that app', async () => {
    fs.mkdirSync(path.join(repo, '.git'));
    write('package.json', pkg());
    write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
    write('apps/web/package.json', pkg({ next: '15.0.0' }));
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    const plan = buildPlan(store.session, PROGRAM);
    expect(planNeedsPick(plan)).toBe(false);
    expect(plan.picked).toBe('apps/web');
  });

  it('keeps the project the run started in', async () => {
    const { session } = await discovered('apps/admin');
    expect(session.runProject).toBe('apps/admin');
    expect(buildPlan(session, PROGRAM).picked).toBe('apps/admin');
  });

  it('takes the main app at a workspace root, once a source names one', async () => {
    const store = await discovered();
    // No model answered: several apps, so the run stays where it started.
    expect(buildPlan(store.session, PROGRAM).picked).toBe('.');

    setTrait(store.readyContext(), 'apps/web', 'mainApp', 'yes', 'agentic');
    const plan = buildPlan(store.session, PROGRAM);
    expect(plan.picked).toBe('apps/web');
    expect(row(plan, 'apps/web')?.mainApp).toBe(true);
  });

  it('starts on the project the caller asked for', async () => {
    const { session } = await discovered();
    expect(buildPlan(session, PROGRAM, 'apps/admin').picked).toBe('apps/admin');
  });

  it('asks nothing in a single app that holds manifests below it', async () => {
    write('package.json', pkg({ next: '15.0.0' }));
    write('app/layout.tsx');
    write('tools/seed/package.json', pkg());
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    const plan = buildPlan(store.session, PROGRAM);
    expect(plan.repoType).toBe('single');
    expect(plan.projects).toHaveLength(2);
    expect(plan.picked).toBe('.');
    expect(planNeedsPick(plan)).toBe(false);
  });

  it('keeps a workspace root that is an app itself', async () => {
    write('package.json', pkg({ next: '15.0.0' }));
    write('app/layout.tsx');
    write('pnpm-workspace.yaml', 'packages:\n  - proxy\n');
    write('proxy/package.json', pkg({ express: '^4.0.0' }));
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    store.setFrameworkConfig(Integration.nextjs, null);
    const plan = buildPlan(store.session, PROGRAM);
    expect(plan.repoType).toBe('monorepo');
    expect(row(plan, '.')).toMatchObject({ offered: true });
    expect(row(plan, '.')?.reason).toBeUndefined();
    expect(plan.picked).toBe('.');
  });

  it('has no choice to offer in a single-app repo', async () => {
    write('package.json', pkg({ next: '15.0.0' }));
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    const plan = buildPlan(store.session, PROGRAM);
    expect(plan.projects.map((project) => project.path)).toEqual(['.']);
    expect(plan.picked).toBe('.');
    expect(planNeedsPick(plan)).toBe(false);
  });
});

describe('pickLeavesRunProject', () => {
  it('holds at a workspace root that only holds the apps', async () => {
    const { session } = await discovered();
    expect(pickLeavesRunProject(session, PROGRAM)).toBe(true);
  });

  it('holds where the one app below is taken without a question', async () => {
    fs.mkdirSync(path.join(repo, '.git'));
    write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
    write('apps/web/package.json', pkg({ next: '15.0.0' }));
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    expect(pickLeavesRunProject(store.session, PROGRAM)).toBe(true);
  });

  it('does not hold while the run can stay where it started', async () => {
    // Inside an app, the run keeps it.
    const inApp = await discovered('apps/admin');
    expect(pickLeavesRunProject(inApp.session, PROGRAM)).toBe(false);
  });

  it('does not hold where nobody is asked and no default leaves the root', async () => {
    // CI asks nobody, and no source named a main app among the two.
    const { session } = await discovered('.', { ci: true });
    expect(pickLeavesRunProject(session, PROGRAM)).toBe(false);
  });

  it('does not hold with discovery off, or for a program that picks no project', async () => {
    const on = await discovered();
    expect(pickLeavesRunProject(on.session, {})).toBe(false);

    fs.rmSync(repo, { recursive: true, force: true });
    fs.mkdirSync(repo);
    vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({});
    const off = await discovered();
    expect(pickLeavesRunProject(off.session, PROGRAM)).toBe(false);
  });
});

describe('plan events', () => {
  it('sends nothing before the person agrees to share discovery', async () => {
    const { session } = await discovered();
    const plan = buildPlan(session, PROGRAM);
    reportProjectsDiscovered(session, plan, 'posthog-integration');
    reportProjectsSelected(
      session,
      plan,
      '.',
      'posthog-integration',
      'default',
    );
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });

  it('reports the list and grades each source against the pick', async () => {
    const store = await discovered('.', { ci: true });
    setTrait(store.readyContext(), 'apps/web', 'mainApp', 'yes', 'agentic');
    const plan = buildPlan(store.session, PROGRAM);
    reportProjectsDiscovered(store.session, plan, 'posthog-integration');
    reportProjectsSelected(
      store.session,
      plan,
      'apps/admin',
      'posthog-integration',
      'person',
    );

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'projects discovered',
      expect.objectContaining({
        repo_type: 'monorepo',
        workspace_tool: 'pnpm',
        project_count: 5,
        offered_count: 2,
        projects: expect.arrayContaining([
          {
            path: 'apps/web',
            framework: 'nextjs',
            projectRole: 'app',
            posthogInstalled: 'no',
            recommended: true,
          },
        ]),
      }),
    );
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'projects selected',
      expect.objectContaining({
        picked: 'apps/admin',
        picked_by: 'person',
        default: 'apps/web',
        kept_default: false,
        main_app: 'apps/web',
        kept_main_app: false,
        source_main_apps: { agentic: 'apps/web' },
        sources_matching_pick: [],
      }),
    );
  });
});
