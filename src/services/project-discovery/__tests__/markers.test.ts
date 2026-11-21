import {
  WORKSPACE_MARKERS,
  isWorkspaceMember,
  type MarkerRead,
} from '@services/project-discovery/markers';

const read = (file: string, content: string): MarkerRead | null =>
  WORKSPACE_MARKERS.get(file)?.(content) ?? null;

describe('workspace markers', () => {
  it.each<[string, string, string, MarkerRead | null]>([
    [
      'a pnpm block list',
      'pnpm-workspace.yaml',
      'packages:\n  - \'apps/*\'\n  - "packages/*"  # shared\n  - tools/cli\ncatalog:\n  react: ^18\nonlyBuiltDependencies:\n  - esbuild\n',
      { tool: 'pnpm', members: ['apps/*', 'packages/*', 'tools/cli'] },
    ],
    [
      'a pnpm list at column zero',
      'pnpm-workspace.yaml',
      'packages:\n- apps/*\n- packages/*\n',
      { tool: 'pnpm', members: ['apps/*', 'packages/*'] },
    ],
    [
      'a pnpm list with a comment at column zero inside it',
      'pnpm-workspace.yaml',
      "packages:\n  - 'apps/*'\n# the libraries\n\n  - 'packages/*'\n",
      { tool: 'pnpm', members: ['apps/*', 'packages/*'] },
    ],
    [
      'a pnpm flow list on one line',
      'pnpm-workspace.yaml',
      'packages: [\'apps/*\', "packages/*", tools/cli]\n',
      { tool: 'pnpm', members: ['apps/*', 'packages/*', 'tools/cli'] },
    ],
    [
      'a pnpm flow list across lines',
      'pnpm-workspace.yaml',
      "packages: [\n  'apps/*',\n  '!apps/legacy',\n]\ncatalog: {}\n",
      { tool: 'pnpm', members: ['apps/*', '!apps/legacy'] },
    ],
    [
      'npm workspaces',
      'package.json',
      '{ "workspaces": { "packages": ["apps/*"] } }',
      { tool: 'npm', members: ['apps/*'] },
    ],
    ['a package.json with no workspaces', 'package.json', '{}', null],
    [
      'a root turbo.json',
      'turbo.json',
      '{ "tasks": {} }',
      { tool: 'turbo', members: [], open: true },
    ],
    ['a package turbo.json', 'turbo.json', '{ "extends": ["//"] }', null],
    ['nx.json', 'nx.json', '{}', { tool: 'nx', members: [], open: true }],
    [
      'lerna.json with packages',
      'lerna.json',
      '{ "packages": ["modules/*"] }',
      { tool: 'lerna', members: ['modules/*'] },
    ],
    [
      'lerna.json with its default',
      'lerna.json',
      '{}',
      { tool: 'lerna', members: ['packages/*'] },
    ],
    [
      'a Cargo workspace',
      'Cargo.toml',
      '[workspace]\nmembers = [\n  "crates/*", # all of them\n  "tools/[a-z]*",\n]\nexclude = ["crates/old"]\n\n[workspace.dependencies]\nserde = "1"\n',
      {
        tool: 'cargo',
        members: ['crates/*', 'tools/[a-z]*', '!crates/old'],
      },
    ],
    [
      'a Cargo.toml with no workspace',
      'Cargo.toml',
      '[package]\nname = "app"\n',
      null,
    ],
    [
      'go.work',
      'go.work',
      'go 1.22\n\nuse (\n\t./api // the service\n\t./worker\n)\nuse ./tools\n',
      { tool: 'go', members: ['./api', './worker', './tools'] },
    ],
    [
      'settings.gradle.kts',
      'settings.gradle.kts',
      'rootProject.name = "shop"\ninclude(":app", ":libs:core")\n',
      { tool: 'gradle', members: ['app', 'libs/core'] },
    ],
    [
      'a uv workspace',
      'pyproject.toml',
      '[project]\nname = "root"\n\n[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages/seed"]\n',
      { tool: 'uv', members: ['packages/*', '!packages/seed'] },
    ],
    [
      'a pyproject.toml with no uv workspace',
      'pyproject.toml',
      '[project]\nname = "app"\n',
      null,
    ],
  ])('reads %s', (_name, file, content, expected) => {
    expect(read(file, content)).toEqual(expected);
  });

  it('reads a marker of long whitespace runs in linear time', () => {
    const started = Date.now();
    read('pnpm-workspace.yaml', `packages:\n  - ${' '.repeat(200_000)}'"\n`);
    read('Cargo.toml', `[workspace]\n${'\n'.repeat(200_000)}members = ["a"]`);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('isWorkspaceMember', () => {
  const workspace = (...members: string[]): MarkerRead => ({
    tool: 'pnpm',
    members,
  });

  it('matches a member glob and leaves out an excluded one', () => {
    const globs = workspace('./apps/*/', '!apps/legacy');
    expect(isWorkspaceMember('apps/web', globs)).toBe(true);
    expect(isWorkspaceMember('apps/legacy', globs)).toBe(false);
    expect(isWorkspaceMember('packages/ui', globs)).toBe(false);
    expect(isWorkspaceMember('.', globs)).toBe(false);
  });

  it('takes every directory below an open workspace', () => {
    expect(
      isWorkspaceMember('anything/at/all', {
        tool: 'nx',
        members: [],
        open: true,
      }),
    ).toBe(true);
  });

  it('reads no glob that leaves the root or is too long to be a path', () => {
    expect(isWorkspaceMember('apps/web', workspace('../**'))).toBe(false);
    expect(
      isWorkspaceMember('apps/web', workspace(`${'*'.repeat(300)}/**`)),
    ).toBe(false);
  });
});
