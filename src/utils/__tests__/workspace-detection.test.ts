import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  detectWorkspaces,
  parsePnpmWorkspaceYaml,
} from '../workspace-detection';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'workspace-detect-'),
  );
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

/** Helper: create a file with optional content */
async function createFile(relativePath: string, content = ''): Promise<void> {
  const fullPath = path.join(tmpDir, relativePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// parsePnpmWorkspaceYaml (pure function, no filesystem)
// ---------------------------------------------------------------------------

describe('parsePnpmWorkspaceYaml', () => {
  it('parses standard packages list', () => {
    const yaml = `packages:
  - 'apps/*'
  - 'packages/*'
`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual(['apps/*', 'packages/*']);
  });

  it('handles double-quoted patterns', () => {
    const yaml = `packages:
  - "apps/*"
  - "libs/*"
`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual(['apps/*', 'libs/*']);
  });

  it('handles unquoted patterns', () => {
    const yaml = `packages:
  - apps/*
  - libs/*
`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual(['apps/*', 'libs/*']);
  });

  it('skips negated patterns', () => {
    const yaml = `packages:
  - 'apps/*'
  - '!apps/internal'
`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual(['apps/*']);
  });

  it('stops at next top-level key', () => {
    const yaml = `packages:
  - 'apps/*'
other:
  - foo
`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual(['apps/*']);
  });

  it('returns empty for no packages key', () => {
    const yaml = `something:
  - value
`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual([]);
  });

  it('skips comments and empty lines', () => {
    const yaml = `packages:
  # A comment
  - 'apps/*'

  - 'packages/*'
`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual(['apps/*', 'packages/*']);
  });
});

// ---------------------------------------------------------------------------
// detectWorkspaces — pnpm
// ---------------------------------------------------------------------------

describe('detectWorkspaces — pnpm', () => {
  it('detects pnpm workspace with pnpm-workspace.yaml', async () => {
    await createFile(
      'pnpm-workspace.yaml',
      `packages:\n  - 'apps/*'\n  - 'packages/*'\n`,
    );
    await createFile('apps/web/package.json', '{}');
    await createFile('apps/api/package.json', '{}');
    await createFile('packages/shared/package.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('pnpm');
    expect(result!.memberDirs).toHaveLength(3);
    expect(result!.memberDirs).toContain(path.resolve(tmpDir, 'apps/web'));
    expect(result!.memberDirs).toContain(path.resolve(tmpDir, 'apps/api'));
    expect(result!.memberDirs).toContain(
      path.resolve(tmpDir, 'packages/shared'),
    );
  });

  it('labels as turbo when turbo.json is present', async () => {
    await createFile(
      'pnpm-workspace.yaml',
      `packages:\n  - 'apps/*'\n`,
    );
    await createFile('turbo.json', '{}');
    await createFile('apps/web/package.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('turbo');
  });
});

// ---------------------------------------------------------------------------
// detectWorkspaces — npm/yarn via package.json workspaces
// ---------------------------------------------------------------------------

describe('detectWorkspaces — npm/yarn', () => {
  it('detects npm workspaces from package.json array', async () => {
    await createFile(
      'package.json',
      JSON.stringify({ workspaces: ['apps/*', 'libs/*'] }),
    );
    await createFile('apps/frontend/package.json', '{}');
    await createFile('libs/utils/package.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('npm');
    expect(result!.memberDirs).toHaveLength(2);
  });

  it('detects yarn classic workspaces from packages object', async () => {
    await createFile(
      'package.json',
      JSON.stringify({ workspaces: { packages: ['packages/*'] } }),
    );
    await createFile('yarn.lock', '');
    await createFile('packages/a/package.json', '{}');
    await createFile('packages/b/package.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('yarn');
    expect(result!.memberDirs).toHaveLength(2);
  });

  it('labels as turbo when turbo.json + package.json workspaces', async () => {
    await createFile(
      'package.json',
      JSON.stringify({ workspaces: ['apps/*'] }),
    );
    await createFile('turbo.json', '{}');
    await createFile('apps/web/package.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('turbo');
  });
});

// ---------------------------------------------------------------------------
// detectWorkspaces — lerna
// ---------------------------------------------------------------------------

describe('detectWorkspaces — lerna', () => {
  it('detects lerna workspace from lerna.json', async () => {
    await createFile(
      'lerna.json',
      JSON.stringify({ packages: ['packages/*'] }),
    );
    await createFile('packages/core/package.json', '{}');
    await createFile('packages/cli/package.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('lerna');
    expect(result!.memberDirs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// detectWorkspaces — nx
// ---------------------------------------------------------------------------

describe('detectWorkspaces — nx', () => {
  it('detects nx workspace via project.json files', async () => {
    await createFile('nx.json', '{}');
    await createFile('apps/web/project.json', '{}');
    await createFile('libs/shared/project.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('nx');
    expect(result!.memberDirs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// detectWorkspaces — heuristic
// ---------------------------------------------------------------------------

describe('detectWorkspaces — heuristic', () => {
  it('detects monorepo from multiple package.json files', async () => {
    // No formal workspace config, just multiple subdirs with package.json
    await createFile('frontend/package.json', '{}');
    await createFile('backend/package.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('heuristic');
    expect(result!.memberDirs).toHaveLength(2);
  });

  it('detects mixed JS + Python project roots', async () => {
    await createFile('web/package.json', '{}');
    await createFile('api/requirements.txt', 'posthog\n');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('heuristic');
    expect(result!.memberDirs).toHaveLength(2);
  });

  it('detects mixed JS + Django project roots', async () => {
    await createFile('frontend/package.json', '{}');
    await createFile('backend/manage.py', '#!/usr/bin/env python\n');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('heuristic');
    expect(result!.memberDirs).toHaveLength(2);
  });

  it('detects mixed JS + Laravel project roots', async () => {
    await createFile('web/package.json', '{}');
    await createFile('api/composer.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('heuristic');
    expect(result!.memberDirs).toHaveLength(2);
  });

  it('detects Android build.gradle projects', async () => {
    await createFile('web/package.json', '{}');
    await createFile('android/build.gradle', '');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('heuristic');
    expect(result!.memberDirs).toHaveLength(2);
  });

  it('detects Android build.gradle.kts projects', async () => {
    await createFile('web/package.json', '{}');
    await createFile('android/build.gradle.kts', '');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('heuristic');
    expect(result!.memberDirs).toHaveLength(2);
  });

  it('detects Swift Package.swift projects', async () => {
    await createFile('web/package.json', '{}');
    await createFile('ios/Package.swift', '');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('heuristic');
    expect(result!.memberDirs).toHaveLength(2);
  });

  it('detects pyproject.toml projects', async () => {
    await createFile('web/package.json', '{}');
    await createFile('ml/pyproject.toml', '');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('heuristic');
    expect(result!.memberDirs).toHaveLength(2);
  });

  it('deduplicates directories with multiple indicators', async () => {
    // A single dir with both package.json and pyproject.toml should count once
    await createFile('app-a/package.json', '{}');
    await createFile('app-b/package.json', '{}');
    await createFile('app-b/pyproject.toml', '');

    const result = await detectWorkspaces(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('heuristic');
    expect(result!.memberDirs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// detectWorkspaces — not a monorepo
// ---------------------------------------------------------------------------

describe('detectWorkspaces — single project (not a monorepo)', () => {
  it('returns null for a single package.json project', async () => {
    await createFile('package.json', '{}');
    await createFile('src/index.ts', '');

    const result = await detectWorkspaces(tmpDir);

    expect(result).toBeNull();
  });

  it('returns null for an empty directory', async () => {
    const result = await detectWorkspaces(tmpDir);

    expect(result).toBeNull();
  });

  it('returns null for single subdir project', async () => {
    await createFile('app/package.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    // Only 1 candidate dir — below the 2-dir threshold
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Exclusion patterns
// ---------------------------------------------------------------------------

describe('detectWorkspaces — exclusions', () => {
  it('ignores node_modules directories', async () => {
    await createFile('app/package.json', '{}');
    await createFile('node_modules/some-pkg/package.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    // Only 1 real candidate (node_modules excluded) — should not trigger monorepo
    expect(result).toBeNull();
  });

  it('ignores dist directories', async () => {
    await createFile('app/package.json', '{}');
    await createFile('dist/server/package.json', '{}');

    const result = await detectWorkspaces(tmpDir);

    expect(result).toBeNull();
  });
});
