import fs from 'fs';
import path from 'path';
import { Integration } from '../lib/constants';

/** Generic language integrations that need extra app-vs-library filtering. */
const LANGUAGE_FALLBACK_INTEGRATIONS = new Set<Integration>([
  Integration.python,
  Integration.javascript_web,
  Integration.javascriptNode,
]);

/** Check whether a project is likely an app (vs a library). Framework-specific integrations always pass. */
export async function isLikelyApp(
  dir: string,
  integration: Integration,
): Promise<boolean> {
  if (!LANGUAGE_FALLBACK_INTEGRATIONS.has(integration)) {
    return true;
  }

  if (integration === Integration.python) {
    return isLikelyPythonApp(dir);
  }

  if (
    integration === Integration.javascript_web ||
    integration === Integration.javascriptNode
  ) {
    return isLikelyJsApp(dir);
  }

  return true;
}

const PYTHON_APP_ENTRY_POINTS = [
  'main.py',
  'app.py',
  'wsgi.py',
  'asgi.py',
  'server.py',
  '__main__.py',
  'cli.py',
  'manage.py',
];

async function isLikelyPythonApp(dir: string): Promise<boolean> {
  // Check for common app entry point files
  for (const entryPoint of PYTHON_APP_ENTRY_POINTS) {
    try {
      await fs.promises.access(path.join(dir, entryPoint));
      return true;
    } catch {
      // continue
    }
  }

  // Check pyproject.toml for script entry points
  try {
    const content = await fs.promises.readFile(
      path.join(dir, 'pyproject.toml'),
      'utf-8',
    );
    if (
      content.includes('[project.scripts]') ||
      content.includes('[tool.poetry.scripts]') ||
      content.includes('[project.gui-scripts]')
    ) {
      return true;
    }
  } catch {
    // File doesn't exist or can't be read
  }

  return false;
}

/** Min dependency count for a JS package to qualify as an app by scripts alone. */
const MIN_JS_APP_DEPENDENCY_COUNT = 8;

/** Dependency prefixes that indicate a dev tool (Storybook, Playwright, etc.). */
const DEV_TOOL_DEPENDENCY_PREFIXES = [
  '@storybook/',
  'chromatic',
  '@playwright/',
  'playwright',
  '@cypress/',
  'cypress',
];

function hasDevToolDependencies(pkg: Record<string, unknown>): boolean {
  const allDeps = [
    ...Object.keys((pkg.dependencies as Record<string, string>) ?? {}),
    ...Object.keys((pkg.devDependencies as Record<string, string>) ?? {}),
  ];
  return DEV_TOOL_DEPENDENCY_PREFIXES.some((prefix) =>
    allDeps.some((dep) => dep === prefix || dep.startsWith(prefix)),
  );
}

/** Check whether a JS/TS directory looks like an app rather than a library or utility. */
async function isLikelyJsApp(dir: string): Promise<boolean> {
  // Check for index.html (web app entry point) — strong signal
  const htmlPaths = ['index.html', 'public/index.html', 'src/index.html'];
  for (const htmlPath of htmlPaths) {
    try {
      await fs.promises.access(path.join(dir, htmlPath));
      return true;
    } catch {
      // continue
    }
  }

  // Check for common server entry points — strong signal
  const serverEntryPoints = [
    'server.ts',
    'server.js',
    'app.ts',
    'app.js',
    'src/server.ts',
    'src/server.js',
    'src/app.ts',
    'src/app.js',
  ];
  for (const entryPoint of serverEntryPoints) {
    try {
      await fs.promises.access(path.join(dir, entryPoint));
      return true;
    } catch {
      // continue
    }
  }

  // Check package.json for app-like scripts — weaker signal.
  // In monorepos, many utility packages have start/dev scripts for build
  // watchers. Require a minimum dependency count to filter out tiny tools.
  try {
    const content = await fs.promises.readFile(
      path.join(dir, 'package.json'),
      'utf-8',
    );
    const pkg = JSON.parse(content);

    // Filter out dev tool environments (Storybook, Playwright, Cypress, etc.)
    if (hasDevToolDependencies(pkg)) {
      return false;
    }

    const scripts = pkg.scripts ?? {};
    const appScripts = ['start', 'dev', 'serve', 'preview'];
    if (appScripts.some((s) => s in scripts)) {
      const depCount =
        Object.keys(pkg.dependencies ?? {}).length +
        Object.keys(pkg.devDependencies ?? {}).length;
      return depCount >= MIN_JS_APP_DEPENDENCY_COUNT;
    }
  } catch {
    // No package.json or invalid JSON
  }

  return false;
}
