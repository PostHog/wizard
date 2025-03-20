import { getPackageDotJson } from '../utils/clack-utils';
import { hasPackageInstalled } from '../utils/package-json';
import type { WizardOptions } from '../utils/types';
import { Integration } from './constants';

type IntegrationConfig = {
  name: string;
  filterPatterns: string[];
  ignorePatterns: string[];
  detect: (options: Pick<WizardOptions, 'installDir'>) => Promise<boolean>;
  generateFilesRules: string;
  filterFilesRules: string;
};

export const INTEGRATION_CONFIG = {
  [Integration.nextjs]: {
    name: 'Next.js',
    filterPatterns: ['**/*.{tsx,ts,jsx,js,mjs,cjs}'],
    ignorePatterns: [
      'node_modules',
      'dist',
      'build',
      'public',
      'static',
      'next-env.d.*',
    ],
    detect: async (options) => {
      const packageJson = await getPackageDotJson(options);
      return hasPackageInstalled('next', packageJson);
    },
    generateFilesRules: '',
    filterFilesRules: '',
  },
  [Integration.react]: {
    name: 'React',
    filterPatterns: ['**/*.{tsx,ts,jsx,js}'],
    ignorePatterns: [
      'node_modules',
      'dist',
      'build',
      'public',
      'static',
      'assets',
    ],
    detect: async (options) => {
      const packageJson = await getPackageDotJson(options);
      return hasPackageInstalled('react', packageJson);
    },
    generateFilesRules: '',
    filterFilesRules: '',
  },
} as const satisfies Record<Integration, IntegrationConfig>;

export const INTEGRATION_ORDER = [
  Integration.nextjs,
  Integration.react,
] as const;
