import fg from 'fast-glob';
import fs from 'fs/promises';
import path from 'path';
import { abortIfCancelled } from '../utils/clack-utils';
import clack from '../utils/clack';
import type { WizardOptions } from '../utils/types';
import { Integration } from '../lib/constants';
import { createVersionBucket } from '../utils/semver';

export const getAstroVersionBucket = createVersionBucket();

export enum AstroRenderingMode {
  STATIC = 'static',
  SSR = 'ssr',
  HYBRID = 'hybrid',
  VIEW_TRANSITIONS = 'view-transitions',
}

export const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.astro/**',
];

/**
 * Detect the Astro rendering mode by analyzing:
 * 1. astro.config.* for output mode
 * 2. Package.json for adapters
 * 3. Source files for view transitions usage
 */
export async function getAstroRenderingMode({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<AstroRenderingMode> {
  // Check for astro config file
  const configMatches = await fg('astro.config.@(mjs|ts|js)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  let hasAdapter = false;
  let outputMode: string | null = null;
  let usesViewTransitions = false;

  // Check package.json for adapters
  try {
    const packageJsonPath = path.join(installDir, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    // Check for Astro adapters (node, vercel, netlify, cloudflare, etc.)
    hasAdapter = Object.keys(allDeps).some(
      (dep) =>
        dep.startsWith('@astrojs/') &&
        (dep.includes('node') ||
          dep.includes('vercel') ||
          dep.includes('netlify') ||
          dep.includes('cloudflare') ||
          dep.includes('deno')),
    );
  } catch {
    // package.json not found or invalid
  }

  // Parse astro config for output mode
  if (configMatches.length > 0) {
    try {
      const configPath = path.join(installDir, configMatches[0]);
      const configContent = await fs.readFile(configPath, 'utf-8');

      // Simple regex to detect output mode
      const outputMatch = configContent.match(/output:\s*['"](\w+)['"]/);
      if (outputMatch) {
        outputMode = outputMatch[1];
      }
    } catch {
      // Config file not readable
    }
  }

  // Check for view transitions usage
  const viewTransitionMatches = await fg('**/*.@(astro|ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const file of viewTransitionMatches.slice(0, 20)) {
    // Check first 20 files
    try {
      const filePath = path.join(installDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      if (
        content.includes('ClientRouter') ||
        content.includes('ViewTransitions') ||
        content.includes('astro:transitions')
      ) {
        usesViewTransitions = true;
        break;
      }
    } catch {
      // File not readable
    }
  }

  // Determine rendering mode based on findings
  if (usesViewTransitions) {
    clack.log.info(`Detected Astro with View Transitions (ClientRouter) 🔄`);
    return AstroRenderingMode.VIEW_TRANSITIONS;
  }

  if (outputMode === 'server' && hasAdapter) {
    clack.log.info(`Detected Astro SSR mode 🖥️`);
    return AstroRenderingMode.SSR;
  }

  // In Astro 5, 'static' is the default and supports per-page SSR opt-in when an adapter is present
  // This is the "hybrid" pattern even if output mode isn't explicitly set
  if (hasAdapter) {
    clack.log.info(`Detected Astro hybrid mode 🔀`);
    return AstroRenderingMode.HYBRID;
  }

  if (!hasAdapter) {
    clack.log.info(`Detected Astro static mode 📄`);
    return AstroRenderingMode.STATIC;
  }

  // If detection is ambiguous, ask the user
  const result: AstroRenderingMode = await abortIfCancelled(
    clack.select({
      message: 'What rendering mode is your Astro project using?',
      options: [
        {
          label: getAstroRenderingModeName(AstroRenderingMode.STATIC),
          value: AstroRenderingMode.STATIC,
          hint: 'Pre-rendered static HTML (default)',
        },
        {
          label: getAstroRenderingModeName(AstroRenderingMode.VIEW_TRANSITIONS),
          value: AstroRenderingMode.VIEW_TRANSITIONS,
          hint: 'Static with ClientRouter for SPA-like navigation',
        },
        {
          label: getAstroRenderingModeName(AstroRenderingMode.HYBRID),
          value: AstroRenderingMode.HYBRID,
          hint: 'Mostly static with some SSR pages',
        },
        {
          label: getAstroRenderingModeName(AstroRenderingMode.SSR),
          value: AstroRenderingMode.SSR,
          hint: 'Full server-side rendering',
        },
      ],
    }),
    Integration.astro,
  );

  return result;
}

export const getAstroRenderingModeName = (mode: AstroRenderingMode): string => {
  switch (mode) {
    case AstroRenderingMode.STATIC:
      return 'Static (SSG)';
    case AstroRenderingMode.VIEW_TRANSITIONS:
      return 'View Transitions';
    case AstroRenderingMode.SSR:
      return 'Server (SSR)';
    case AstroRenderingMode.HYBRID:
      return 'Hybrid';
    default:
      return 'Static';
  }
};
