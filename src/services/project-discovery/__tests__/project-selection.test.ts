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
  applyDetectionReport,
  buildProjectSelection,
  pickLeavesRunProject,
  hasMultipleEligibleProjects,
  shouldRankProjects,
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

/** Two apps side by side with no workspace marker, which static discovery reads as a `single` repo. */
async function unmarked(args: { ci?: boolean } = {}): Promise<SessionStore> {
  write('web/package.json', pkg({ next: '15.0.0' }));
  write('admin/package.json', pkg({ vue: '^3.4.0' }));
  const store = new SessionStore(buildSession({ installDir: repo, ...args }));
  await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
  return store;
}

const row = (
  projectSelection: ReturnType<typeof buildProjectSelection>,
  projectPath: string,
) => projectSelection.projects.find((project) => project.path === projectPath);

beforeEach(() => {
  repo = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'project-selection-')),
  );
  vi.mocked(analytics.wizardCapture).mockClear();
  vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({
    [WIZARD_PROJECT_DISCOVERY_FLAG_KEY]: 'one-project',
  });
});

afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('buildProjectSelection', () => {
  it('marks the apps eligible and gives a reason for every other project', async () => {
    const { session } = await discovered();
    const projectSelection = buildProjectSelection(session, PROGRAM);
    expect(projectSelection.repoType).toBe('monorepo');
    expect(row(projectSelection, 'apps/web')).toMatchObject({
      eligible: true,
      frameworkName: 'Next.js',
    });
    expect(row(projectSelection, 'apps/admin')?.eligible).toBe(true);
    expect(row(projectSelection, 'apps/docs')).toMatchObject({
      eligible: false,
      exclusionReason: 'has-posthog',
    });
    expect(row(projectSelection, 'packages/ui')).toMatchObject({
      eligible: false,
      exclusionReason: 'library',
    });
    // The root only holds the apps, so the run starting there does not offer it.
    expect(row(projectSelection, '.')).toMatchObject({
      eligible: false,
      exclusionReason: 'workspace-root',
    });
    expect(hasMultipleEligibleProjects(projectSelection)).toBe(true);
  });

  it('asks nothing at a workspace root that holds one app, and takes that app', async () => {
    fs.mkdirSync(path.join(repo, '.git'));
    write('package.json', pkg());
    write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
    write('apps/web/package.json', pkg({ next: '15.0.0' }));
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    const projectSelection = buildProjectSelection(store.session, PROGRAM);
    expect(hasMultipleEligibleProjects(projectSelection)).toBe(false);
    expect(projectSelection.selectedProjectPath).toBe('apps/web');
  });

  it('keeps the project the run started in', async () => {
    const { session } = await discovered('apps/admin');
    expect(session.runProject).toBe('apps/admin');
    expect(buildProjectSelection(session, PROGRAM).selectedProjectPath).toBe(
      'apps/admin',
    );
  });

  it('takes the main app at a workspace root, once a source names one', async () => {
    const store = await discovered();
    // No model answered: several apps, so the run stays where it started.
    expect(
      buildProjectSelection(store.session, PROGRAM).selectedProjectPath,
    ).toBe('.');

    setTrait(store.readyContext(), 'apps/web', 'mainApp', 'yes', 'agentic');
    const projectSelection = buildProjectSelection(store.session, PROGRAM);
    expect(projectSelection.selectedProjectPath).toBe('apps/web');
    expect(row(projectSelection, 'apps/web')?.isMainApp).toBe(true);
  });

  it('starts on the project the caller asked for', async () => {
    const { session } = await discovered();
    expect(
      buildProjectSelection(session, PROGRAM, 'apps/admin').selectedProjectPath,
    ).toBe('apps/admin');
  });

  it('asks nothing in a single app that holds manifests below it', async () => {
    write('package.json', pkg({ next: '15.0.0' }));
    write('app/layout.tsx');
    write('tools/seed/package.json', pkg());
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    const projectSelection = buildProjectSelection(store.session, PROGRAM);
    expect(projectSelection.repoType).toBe('single');
    expect(projectSelection.projects).toHaveLength(2);
    expect(projectSelection.selectedProjectPath).toBe('.');
    expect(hasMultipleEligibleProjects(projectSelection)).toBe(false);
  });

  it('keeps a workspace root that is an app itself', async () => {
    write('package.json', pkg({ next: '15.0.0' }));
    write('app/layout.tsx');
    write('pnpm-workspace.yaml', 'packages:\n  - proxy\n');
    write('proxy/package.json', pkg({ express: '^4.0.0' }));
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    store.setFrameworkConfig(Integration.nextjs, null);
    const projectSelection = buildProjectSelection(store.session, PROGRAM);
    expect(projectSelection.repoType).toBe('monorepo');
    expect(row(projectSelection, '.')).toMatchObject({ eligible: true });
    expect(row(projectSelection, '.')?.exclusionReason).toBeUndefined();
    expect(projectSelection.selectedProjectPath).toBe('.');
  });

  it('has no choice to offer in a single-app repo', async () => {
    write('package.json', pkg({ next: '15.0.0' }));
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    const projectSelection = buildProjectSelection(store.session, PROGRAM);
    expect(projectSelection.projects.map((project) => project.path)).toEqual([
      '.',
    ]);
    expect(projectSelection.selectedProjectPath).toBe('.');
    expect(hasMultipleEligibleProjects(projectSelection)).toBe(false);
  });

  it('offers a choice with no workspace marker, once a model names a main app elsewhere', async () => {
    const store = await unmarked();
    const before = buildProjectSelection(store.session, PROGRAM);
    expect(before.repoType).toBe('single');
    expect(hasMultipleEligibleProjects(before)).toBe(false);
    expect(before.selectedProjectPath).toBe('.');

    setTrait(store.readyContext(), 'web', 'mainApp', 'yes', 'decisions');
    const projectSelection = buildProjectSelection(store.session, PROGRAM);
    expect(projectSelection.repoType).toBe('single');
    expect(hasMultipleEligibleProjects(projectSelection)).toBe(true);
    expect(projectSelection.selectedProjectPath).toBe('web');
  });

  it('offers a choice where a model calls the repo a monorepo and names no main app', async () => {
    const store = await unmarked();
    applyDetectionReport(
      store.readyContext(),
      { repoType: 'monorepo', projects: [] },
      'agentic',
    );
    const projectSelection = buildProjectSelection(store.session, PROGRAM);
    expect(hasMultipleEligibleProjects(projectSelection)).toBe(true);
    expect(projectSelection.selectedProjectPath).toBe('.');
  });

  it('asks nothing where a model calls the repo single and names the run project', async () => {
    write('package.json', pkg({ next: '15.0.0' }));
    write('app/layout.tsx');
    write('docs/package.json', pkg({ vue: '^3.4.0' }));
    const store = new SessionStore(buildSession({ installDir: repo }));
    await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
    applyDetectionReport(
      store.readyContext(),
      {
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework: 'Next.js',
            targetId: 'nextjs',
            hasPostHog: false,
            recommended: true,
          },
        ],
      },
      'agentic',
    );
    const projectSelection = buildProjectSelection(store.session, PROGRAM);
    expect(
      projectSelection.projects.filter((project) => project.eligible),
    ).toHaveLength(2);
    expect(hasMultipleEligibleProjects(projectSelection)).toBe(false);
    expect(projectSelection.selectedProjectPath).toBe('.');
  });
});

describe('shouldRankProjects', () => {
  it('ranks a CI run with several projects and no workspace marker, until a model answers', async () => {
    const store = await unmarked({ ci: true });
    const ranks = () =>
      shouldRankProjects(
        store.session,
        buildProjectSelection(store.session, PROGRAM),
      );
    expect(ranks()).toBe(true);

    applyDetectionReport(
      store.readyContext(),
      { repoType: 'single', projects: [] },
      'agentic',
    );
    expect(ranks()).toBe(false);
  });

  it("still ranks a CI run when a model answered only the program's questions", async () => {
    const store = await unmarked({ ci: true });
    // What Decisions leaves when its program answers land and its ranking fails.
    setTrait(store.readyContext(), '.', 'callsLlmApi', 'no', 'decisions', 0.9);
    expect(
      shouldRankProjects(
        store.session,
        buildProjectSelection(store.session, PROGRAM),
      ),
    ).toBe(true);
  });

  it('leaves an interactive run unranked where there is no choice', async () => {
    const store = await unmarked();
    expect(
      shouldRankProjects(
        store.session,
        buildProjectSelection(store.session, PROGRAM),
      ),
    ).toBe(false);
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

describe('project selection events', () => {
  it('sends nothing before the person agrees to share discovery', async () => {
    const { session } = await discovered();
    const projectSelection = buildProjectSelection(session, PROGRAM);
    reportProjectsDiscovered(session, projectSelection, 'posthog-integration');
    reportProjectsSelected(
      session,
      projectSelection,
      '.',
      'posthog-integration',
      'default',
    );
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });

  it('reports the list and grades each source against the pick', async () => {
    const store = await discovered('.', { ci: true });
    setTrait(store.readyContext(), 'apps/web', 'mainApp', 'yes', 'agentic');
    const projectSelection = buildProjectSelection(store.session, PROGRAM);
    reportProjectsDiscovered(
      store.session,
      projectSelection,
      'posthog-integration',
    );
    reportProjectsSelected(
      store.session,
      projectSelection,
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
        picked_framework: 'vue',
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
