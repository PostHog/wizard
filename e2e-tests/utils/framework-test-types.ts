import type { WizardTestEnv } from './index';

export interface WizardStep {
  name: string;
  waitFor: string;
  response?: string[] | string;
  responseWaitFor?: string;
  timeout?: number;
  optional?: boolean;
  condition?: (instance: WizardTestEnv) => boolean;
}

export interface FrameworkTestConfig {
  /** Framework name for the test suite */
  name: string;
  /** Relative path to the test application directory */
  projectDir: string;
  /** Expected output strings for different modes */
  expectedOutput: {
    dev: string;
    prod?: string;
  };
  /** Custom wizard flow steps (overrides default flow) */
  customWizardSteps?: WizardStep[];
  /** Additional wizard steps to insert at specific positions */
  additionalSteps?: {
    before?: string; // Insert before this step name
    after?: string; // Insert after this step name
    steps: WizardStep[];
  }[];
  /** Hooks for customizing the test flow */
  hooks?: {
    beforeWizard?: () => Promise<void> | void;
    afterWizard?: () => Promise<void> | void;
    beforeTests?: () => Promise<void> | void;
    afterTests?: () => Promise<void> | void;
  };
  /** Standard tests to run */
  tests?: {
    packageJson?: string[]; // Package names to check
    devMode?: boolean;
    build?: boolean;
    prodMode?: boolean | string; // true for 'start', string for custom command
  };
  /** Custom test definitions */
  customTests?: Array<{
    name: string;
    fn: (projectDir: string) => Promise<void> | void;
  }>;
}
