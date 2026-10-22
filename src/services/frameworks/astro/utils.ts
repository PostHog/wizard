import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import fs from 'fs/promises';
import path from 'path';
import type { WizardRunOptions } from '@utils/types';
import { createVersionBucket } from '@utils/semver';

export const getAstroVersionBucket = createVersionBucket();

export enum AstroRenderingMode {
  STATIC = 'static',
  SSR = 'ssr',
  HYBRID = 'hybrid',
  VIEW_TRANSITIONS = 'view-transitions',
}

const EXTRA_IGNORE = ['**/.astro/**'];

/**
 * Detect the Astro rendering mode. Pure — always resolves (Astro detection is reliable).
 */
export async function getAstroRenderingMode({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<AstroRenderingMode> {
  const configMatches = await boundedGlob('astro.config.@(mjs|ts|js)', {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: 1,
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

  const viewTransitionMatches = await boundedGlob(
    '**/*.@(astro|ts|tsx|js|jsx)',
    {
      cwd: installDir,
      extraIgnore: EXTRA_IGNORE,
      limit: 20,
    },
  );

  for (const file of viewTransitionMatches) {
    const content = readProjectFile(path.join(installDir, file));
    if (!content) continue;
    if (
      content.includes('ClientRouter') ||
      content.includes('ViewTransitions') ||
      content.includes('astro:transitions')
    ) {
      usesViewTransitions = true;
      break;
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
