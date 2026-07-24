import type { WizardRunOptions } from '@utils/types';
import { boundedGlob } from '@utils/bounded-fs';
import { createVersionBucket } from '@utils/semver';

export const getNextJsVersionBucket = createVersionBucket();

export enum NextJsRouter {
  APP_ROUTER = 'app-router',
  PAGES_ROUTER = 'pages-router',
}

export const IGNORE_PATTERNS = ['**/public/**'];

/**
 * Detect Next.js router type. Pure — returns null if ambiguous.
 */
export async function getNextJsRouter({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<NextJsRouter | null> {
  const pagesMatches = await boundedGlob('**/pages/_app.@(ts|tsx|js|jsx)', {
    cwd: installDir,
    extraIgnore: IGNORE_PATTERNS,
    limit: 1,
  });

  const hasPagesDir = pagesMatches.length > 0;

  const appMatches = await boundedGlob('**/app/**/layout.@(ts|tsx|js|jsx)', {
    cwd: installDir,
    extraIgnore: IGNORE_PATTERNS,
    limit: 1,
  });

  const hasAppDir = appMatches.length > 0;

  if (hasPagesDir && !hasAppDir) {
    return NextJsRouter.PAGES_ROUTER;
  }

  if (hasAppDir && !hasPagesDir) {
    return NextJsRouter.APP_ROUTER;
  }

  // Ambiguous (both or neither) — return null, SetupScreen handles it
  return null;
}

export const getNextJsRouterName = (router: NextJsRouter) => {
  return router === NextJsRouter.APP_ROUTER ? 'app router' : 'pages router';
};
