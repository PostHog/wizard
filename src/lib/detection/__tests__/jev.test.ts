import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Integration } from '@lib/constants';
import {
  AI_KINDS,
  AI_NOUL_PREFIX,
  FRAMEWORK_CRITERIA,
  JEV_QUESTIONS,
  NO_FRAMEWORK,
  PRESENCE_LANGUAGES,
  PRESENCE_QUESTIONS,
  SOURCE_QUESTIONS,
  VARIANT_BY_INTEGRATION,
  WAREHOUSE_KINDS,
  WAREHOUSE_NOUL_PREFIX,
  integrationFromChoice,
  variantKeyFor,
} from '@lib/detection/jev/questions';
import {
  AI_SOURCE_KINDS,
  CORE_SOURCE_KINDS,
} from '@lib/warehouse-sources/registry';
import {
  routeIntegration,
  JEV_ACCEPT_CONFIDENCE,
  JEV_AGREE_CONFIDENCE,
} from '@lib/detection/jev/route';
import {
  assembleProjectState,
  renderFileTree,
  scanProject,
} from '@lib/detection/jev/state';

describe('framework criteria', () => {
  it('covers every Integration plus the none label, nothing else', () => {
    const expected = new Set<string>([
      ...Object.values(Integration),
      NO_FRAMEWORK,
    ]);
    expect(new Set(Object.keys(FRAMEWORK_CRITERIA))).toEqual(expected);
  });

  it('maps every variant to a real question and a real Integration', () => {
    for (const [integration, key] of Object.entries(VARIANT_BY_INTEGRATION)) {
      expect(Object.values(Integration)).toContain(integration);
      expect(Object.keys(JEV_QUESTIONS)).toContain(key);
    }
    expect(variantKeyFor(Integration.nextjs)).toBe('nextjs_router');
    expect(variantKeyFor(Integration.tanstackStart)).toBe(
      'tanstack_router_mode',
    );
    expect(variantKeyFor(Integration.django)).toBeUndefined();
    expect(variantKeyFor(null)).toBeUndefined();
  });

  it('maps choice labels back to Integrations', () => {
    expect(integrationFromChoice('nextjs')).toBe(Integration.nextjs);
    expect(integrationFromChoice('react-router')).toBe(Integration.reactRouter);
    expect(integrationFromChoice(NO_FRAMEWORK)).toBeNull();
    expect(integrationFromChoice('not-a-framework')).toBeNull();
  });
});

describe('presence questions', () => {
  it('covers every Integration and language with prefixed nouls', () => {
    const keys = Object.keys(PRESENCE_QUESTIONS);
    for (const integration of Object.values(Integration)) {
      expect(keys).toContain(`fw_${integration}`);
    }
    for (const language of PRESENCE_LANGUAGES) {
      expect(keys).toContain(`lang_${language}`);
    }
    expect(keys).toHaveLength(
      Object.values(Integration).length + PRESENCE_LANGUAGES.length,
    );
  });
});

describe('generated source questions', () => {
  it('covers every core and AI registry kind exactly once', () => {
    expect(new Set(WAREHOUSE_KINDS)).toEqual(new Set(CORE_SOURCE_KINDS));
    expect(new Set(AI_KINDS)).toEqual(new Set(AI_SOURCE_KINDS));
    expect(Object.keys(SOURCE_QUESTIONS)).toHaveLength(
      WAREHOUSE_KINDS.length + AI_KINDS.length,
    );
  });

  it('generates prefixed nouls with instructions', () => {
    for (const [key, question] of Object.entries(SOURCE_QUESTIONS)) {
      expect(
        key.startsWith(WAREHOUSE_NOUL_PREFIX) || key.startsWith(AI_NOUL_PREFIX),
      ).toBe(true);
      expect(question.type).toBe('noul');
      expect(typeof question.instructions).toBe('string');
    }
  });
});

describe('routeIntegration', () => {
  const jev = (
    integration: Integration | null,
    confidence: number,
  ): { integration: Integration | null; confidence: number } => ({
    integration,
    confidence,
  });

  it('falls back to static when jev failed or abstained', () => {
    expect(routeIntegration(null, Integration.nextjs)).toEqual({
      integration: Integration.nextjs,
      source: 'static',
    });
    expect(routeIntegration(jev(null, 0.99), Integration.django)).toEqual({
      integration: Integration.django,
      source: 'static',
    });
  });

  it('accepts jev outright at the accept gate', () => {
    expect(
      routeIntegration(
        jev(Integration.sveltekit, JEV_ACCEPT_CONFIDENCE),
        Integration.javascriptNode,
      ),
    ).toEqual({ integration: Integration.sveltekit, source: 'jev' });
  });

  it('needs static agreement (or a static miss) in the mid band', () => {
    const mid = jev(Integration.nuxt, JEV_AGREE_CONFIDENCE + 0.1);
    expect(routeIntegration(mid, Integration.nuxt)).toEqual({
      integration: Integration.nuxt,
      source: 'jev',
    });
    expect(routeIntegration(mid, undefined)).toEqual({
      integration: Integration.nuxt,
      source: 'jev',
    });
    expect(routeIntegration(mid, Integration.vue)).toEqual({
      integration: Integration.vue,
      source: 'static',
    });
  });

  it('lets static decide below the agree gate', () => {
    expect(
      routeIntegration(
        jev(Integration.rails, JEV_AGREE_CONFIDENCE - 0.1),
        undefined,
      ),
    ).toEqual({ integration: undefined, source: 'static' });
  });
});

describe('renderFileTree', () => {
  it('renders nested paths as an indented tree', () => {
    const tree = renderFileTree([
      'package.json',
      'app/page.tsx',
      'app/layout.tsx',
    ]);
    expect(tree).toBe(
      ['package.json', 'app/', '  layout.tsx', '  page.tsx'].join('\n'),
    );
  });

  it('caps entries per directory with a legible remainder', () => {
    const paths = Array.from(
      { length: 30 },
      (_, i) => `f${String(i).padStart(2, '0')}.ts`,
    );
    const tree = renderFileTree(paths, { maxEntriesPerDir: 5 });
    expect(tree.split('\n')).toHaveLength(6);
    expect(tree).toContain('… +25 more files');
  });

  it('caps total lines and marks truncation', () => {
    const paths = Array.from({ length: 100 }, (_, i) => `dir${i}/file.ts`);
    const tree = renderFileTree(paths, { maxLines: 10 });
    expect(tree.split('\n').length).toBeLessThanOrEqual(11);
    expect(tree).toContain('… (tree truncated)');
  });
});

describe('assembleProjectState', () => {
  const tmpDirs: string[] = [];
  afterAll(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  function project(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-jev-'));
    tmpDirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    return dir;
  }

  it('collects tree, trimmed manifests, lockfiles, and readme head', () => {
    const dir = project({
      'package.json': JSON.stringify({
        name: 'demo',
        dependencies: { next: '15.0.0' },
        private: true,
        description: 'dropped by trimming',
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9',
      'README.md': '# Demo app',
      'app/page.tsx': 'export default function Page() {}',
      '.env': 'SECRET=nope',
    });
    const state = assembleProjectState(dir);
    expect(state.file_tree).toContain('app/');
    expect(state.file_tree).toContain('page.tsx');
    expect(state.lockfiles).toEqual(['pnpm-lock.yaml']);
    expect(state.readme_head).toBe('# Demo app');
    const pkg = JSON.parse(state.manifests['package.json']) as Record<
      string,
      unknown
    >;
    expect(pkg.dependencies).toEqual({ next: '15.0.0' });
    expect(pkg).not.toHaveProperty('description');
    // .env contents must never enter the state.
    expect(JSON.stringify(state)).not.toContain('SECRET=nope');
  });

  it('enumerates manifest-bearing subdirectories for descent, root excluded', () => {
    const dir = project({
      'package.json': '{"name":"root","workspaces":["apps/*"]}',
      'pnpm-workspace.yaml': 'packages:\n  - apps/*',
      'apps/web/package.json': '{"name":"web"}',
      'apps/api/package.json': '{"name":"api"}',
      'services/worker/go.mod': 'module worker',
      'apps/web/src/index.ts': '',
    });
    const { subprojectDirs } = scanProject(dir);
    expect(subprojectDirs).toEqual(
      expect.arrayContaining(['apps/web', 'apps/api', 'services/worker']),
    );
    expect(subprojectDirs).not.toContain('.');
    expect(subprojectDirs).not.toContain('apps/web/src');
  });

  it('prefers shallow manifests when capping', () => {
    const files: Record<string, string> = {
      'package.json': '{"name":"root"}',
    };
    for (let i = 0; i < 30; i++) {
      files[
        `packages/p${String(i).padStart(2, '0')}/package.json`
      ] = `{"name":"p${i}"}`;
    }
    const state = assembleProjectState(project(files));
    expect(Object.keys(state.manifests)[0]).toBe('package.json');
    expect(Object.keys(state.manifests).length).toBeLessThanOrEqual(20);
  });
});
