import { major, minVersion } from 'semver';
import fg from 'fast-glob';
import { abortIfCancelled } from '../utils/clack-utils';
import clack from '../utils/clack';
import type { WizardOptions } from '../utils/types';
import { Integration } from '../lib/constants';

export function getNextJsVersionBucket(version: string | undefined) {
  if (!version) {
    return 'none';
  }

  try {
    const minVer = minVersion(version);
    if (!minVer) {
      return 'invalid';
    }
    const majorVersion = major(minVer);
    if (majorVersion >= 11) {
      return `${majorVersion}.x`;
    }
    return '<11.0.0';
  } catch {
    return 'unknown';
  }
}

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
export async function getNextJsRouter({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<NextJsRouter> {
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
    clack.log.info(
      `Detected ${getNextJsRouterName(NextJsRouter.PAGES_ROUTER)} 📃`,
    );
    return NextJsRouter.PAGES_ROUTER;
  }

  if (hasAppDir && !hasPagesDir) {
    clack.log.info(
      `Detected ${getNextJsRouterName(NextJsRouter.APP_ROUTER)} 📱`,
    );
    return NextJsRouter.APP_ROUTER;
  }

  const result: NextJsRouter = await abortIfCancelled(
    clack.select({
      message: 'What router are you using?',
      options: [
        {
          label: getNextJsRouterName(NextJsRouter.APP_ROUTER),
          value: NextJsRouter.APP_ROUTER,
        },
        {
          label: getNextJsRouterName(NextJsRouter.PAGES_ROUTER),
          value: NextJsRouter.PAGES_ROUTER,
        },
      ],
    }),
    Integration.nextjs,
  );

  return result;
}

export const getNextJsRouterName = (router: NextJsRouter) => {
  return router === NextJsRouter.APP_ROUTER ? 'app router' : 'pages router';
};
