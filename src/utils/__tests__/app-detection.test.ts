import fs from 'fs';
import path from 'path';
import os from 'os';
import { isLikelyApp } from '../app-detection';
import { Integration } from '../../lib/constants';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'app-detect-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

async function createFile(relativePath: string, content = ''): Promise<void> {
  const fullPath = path.join(tmpDir, relativePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Framework-specific integrations — always pass
// ---------------------------------------------------------------------------

describe('isLikelyApp — framework integrations', () => {
  it('always returns true for django', async () => {
    expect(await isLikelyApp(tmpDir, Integration.django)).toBe(true);
  });

  it('always returns true for fastapi', async () => {
    expect(await isLikelyApp(tmpDir, Integration.fastapi)).toBe(true);
  });

  it('always returns true for flask', async () => {
    expect(await isLikelyApp(tmpDir, Integration.flask)).toBe(true);
  });

  it('always returns true for nextjs', async () => {
    expect(await isLikelyApp(tmpDir, Integration.nextjs)).toBe(true);
  });

  it('always returns true for reactRouter', async () => {
    expect(await isLikelyApp(tmpDir, Integration.reactRouter)).toBe(true);
  });

  it('always returns true for laravel', async () => {
    expect(await isLikelyApp(tmpDir, Integration.laravel)).toBe(true);
  });

  it('always returns true for swift', async () => {
    expect(await isLikelyApp(tmpDir, Integration.swift)).toBe(true);
  });

  it('always returns true for android', async () => {
    expect(await isLikelyApp(tmpDir, Integration.android)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Generic Python — requires app evidence
// ---------------------------------------------------------------------------

describe('isLikelyApp — generic python', () => {
  it('returns true when main.py exists', async () => {
    await createFile('main.py', 'print("hello")');
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns true when app.py exists', async () => {
    await createFile('app.py', '');
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns true when wsgi.py exists', async () => {
    await createFile('wsgi.py', '');
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns true when asgi.py exists', async () => {
    await createFile('asgi.py', '');
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns true when server.py exists', async () => {
    await createFile('server.py', '');
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns true when __main__.py exists', async () => {
    await createFile('__main__.py', '');
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns true when cli.py exists', async () => {
    await createFile('cli.py', '');
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns true when manage.py exists', async () => {
    await createFile('manage.py', '');
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns true when pyproject.toml has [project.scripts]', async () => {
    await createFile(
      'pyproject.toml',
      '[project]\nname = "myapp"\n\n[project.scripts]\nmyapp = "myapp:main"',
    );
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns true when pyproject.toml has [tool.poetry.scripts]', async () => {
    await createFile(
      'pyproject.toml',
      '[tool.poetry]\nname = "myapp"\n\n[tool.poetry.scripts]\nmyapp = "myapp:main"',
    );
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns true when pyproject.toml has [project.gui-scripts]', async () => {
    await createFile(
      'pyproject.toml',
      '[project]\nname = "myapp"\n\n[project.gui-scripts]\nmyapp = "myapp:main"',
    );
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(true);
  });

  it('returns false for library with no entry points', async () => {
    await createFile(
      'pyproject.toml',
      '[project]\nname = "parser-lib"\nversion = "1.0.0"\n\n[build-system]\nrequires = ["setuptools"]',
    );
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(false);
  });

  it('returns false for empty directory', async () => {
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(false);
  });

  it('returns false for directory with only requirements.txt', async () => {
    await createFile('requirements.txt', 'numpy\npandas\n');
    expect(await isLikelyApp(tmpDir, Integration.python)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Generic JavaScript — requires app evidence
// ---------------------------------------------------------------------------

// Helper: generate a dependencies object with N entries
function fakeDeps(count: number): Record<string, string> {
  const deps: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    deps[`pkg-${i}`] = '1.0.0';
  }
  return deps;
}

describe('isLikelyApp — generic javascript_web', () => {
  it('returns true when package.json has a start script with enough deps', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        scripts: { start: 'vite preview', build: 'vite build' },
        dependencies: fakeDeps(10),
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(true);
  });

  it('returns true when package.json has a dev script with enough deps', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: fakeDeps(8),
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(true);
  });

  it('returns true when package.json has a serve script with enough deps', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        scripts: { serve: 'serve dist' },
        dependencies: fakeDeps(8),
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(true);
  });

  it('returns true when index.html exists at root', async () => {
    await createFile('index.html', '<html></html>');
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(true);
  });

  it('returns true when public/index.html exists', async () => {
    await createFile('public/index.html', '<html></html>');
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(true);
  });

  it('returns true when src/index.html exists', async () => {
    await createFile('src/index.html', '<html></html>');
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(true);
  });

  it('returns false for start script with too few deps (build tool)', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        name: '@posthog/tailwind',
        scripts: { start: 'tailwindcss --watch' },
        dependencies: fakeDeps(2),
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(false);
  });

  it('returns false for library with only build script', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        name: '@posthog/utils',
        scripts: { build: 'tsc', test: 'jest', lint: 'eslint .' },
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(false);
  });

  it('returns false for empty directory', async () => {
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(false);
  });

  it('counts devDependencies towards threshold', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        scripts: { dev: 'wrangler dev' },
        dependencies: fakeDeps(3),
        devDependencies: fakeDeps(5),
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(true);
  });

  it('returns false for Storybook dev environment despite enough deps', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        scripts: { start: 'storybook dev -p 6006' },
        dependencies: {
          '@storybook/react': '^7.0.0',
          '@storybook/addon-essentials': '^7.0.0',
          ...fakeDeps(20),
        },
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(false);
  });

  it('returns false for Playwright test package despite enough deps', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        scripts: { start: 'playwright test' },
        dependencies: { '@playwright/test': '^1.40.0', ...fakeDeps(10) },
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(false);
  });

  it('returns false for Cypress test package despite enough deps', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        scripts: { start: 'cypress open' },
        dependencies: { cypress: '^13.0.0', ...fakeDeps(10) },
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascript_web)).toBe(false);
  });
});

describe('isLikelyApp — generic javascriptNode', () => {
  it('returns true when package.json has a start script with enough deps', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        scripts: { start: 'node server.js' },
        dependencies: fakeDeps(10),
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascriptNode)).toBe(true);
  });

  it('returns true when server.ts exists', async () => {
    await createFile('server.ts', 'import express from "express"');
    expect(await isLikelyApp(tmpDir, Integration.javascriptNode)).toBe(true);
  });

  it('returns true when app.js exists', async () => {
    await createFile('app.js', 'const app = express()');
    expect(await isLikelyApp(tmpDir, Integration.javascriptNode)).toBe(true);
  });

  it('returns true when src/server.js exists', async () => {
    await createFile('src/server.js', '');
    expect(await isLikelyApp(tmpDir, Integration.javascriptNode)).toBe(true);
  });

  it('returns true when src/app.ts exists', async () => {
    await createFile('src/app.ts', '');
    expect(await isLikelyApp(tmpDir, Integration.javascriptNode)).toBe(true);
  });

  it('returns false for start script with too few deps (CLI tool)', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        name: '@posthog/plugin-transpiler',
        scripts: { start: 'npm run build && npm run start:dist' },
        dependencies: fakeDeps(5),
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascriptNode)).toBe(false);
  });

  it('returns false for library with only build script', async () => {
    await createFile(
      'package.json',
      JSON.stringify({
        name: '@posthog/plugin-scaffold',
        scripts: { build: 'tsc', test: 'jest' },
      }),
    );
    expect(await isLikelyApp(tmpDir, Integration.javascriptNode)).toBe(false);
  });

  it('returns false for empty directory', async () => {
    expect(await isLikelyApp(tmpDir, Integration.javascriptNode)).toBe(false);
  });
});
