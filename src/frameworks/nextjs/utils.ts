import fg from 'fast-glob';
import type { WizardOptions } from '../../utils/types';
import { createVersionBucket } from '../../utils/semver';

export const getNextJsVersionBucket = createVersionBucket();

export enum NextJsRouter {
  APP_ROUTER = 'app-router',
  PAGES_ROUTER = 'pages-router',
}

export const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/public/**',
  '**/.next/**',
];

/**
 * Detect Next.js router type. Pure — returns null if ambiguous.
 */
export async function getNextJsRouter({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<NextJsRouter | null> {
  const pagesMatches = await fg('**/pages/_app.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  const hasPagesDir = pagesMatches.length > 0;

  const appMatches = await fg('**/app/**/layout.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
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
