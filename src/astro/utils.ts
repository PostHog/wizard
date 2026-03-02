import fg from 'fast-glob';
import fs from 'fs/promises';
import path from 'path';
import type { WizardOptions } from '../utils/types';
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
 * Detect the Astro rendering mode. Pure — always resolves (Astro detection is reliable).
 */
export async function getAstroRenderingMode({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<AstroRenderingMode> {
  const configMatches = await fg('astro.config.@(mjs|ts|js)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  let hasAdapter = false;
  let outputMode: string | null = null;
  let usesViewTransitions = false;

  try {
    const packageJsonPath = path.join(installDir, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

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

  if (configMatches.length > 0) {
    try {
      const configPath = path.join(installDir, configMatches[0]);
      const configContent = await fs.readFile(configPath, 'utf-8');
      const outputMatch = configContent.match(/output:\s*['"](\w+)['"]/);
      if (outputMatch) {
        outputMode = outputMatch[1];
      }
    } catch {
      // Config file not readable
    }
  }

  const viewTransitionMatches = await fg('**/*.@(astro|ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const file of viewTransitionMatches.slice(0, 20)) {
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

  if (usesViewTransitions) {
    return AstroRenderingMode.VIEW_TRANSITIONS;
  }

  if (outputMode === 'server' && hasAdapter) {
    return AstroRenderingMode.SSR;
  }

  if (hasAdapter) {
    return AstroRenderingMode.HYBRID;
  }

  return AstroRenderingMode.STATIC;
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
