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
  /** Expected output strings for different modes while running the tests */
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
  hooks?: {
    beforeWizard?: () => Promise<void> | void; // Hook to run before the wizard starts
    afterWizard?: () => Promise<void> | void; // Hook to run after the wizard finishes
    beforeTests?: () => Promise<void> | void; // Hook to run before the tests start
    afterTests?: () => Promise<void> | void; // Hook to run after the tests finish
  };
  /** Standard tests to run */
  tests?: {
    packageJson?: string[]; // Package names to check
    devMode?: boolean; // Whether to test the dev mode
    build?: boolean; // Whether to test if the build command works
    prodMode?: boolean | string; // true for 'start' as prod mode, string for custom command
  };
  /** Custom test definitions */
  customTests?: Array<{
    name: string;
    fn: (projectDir: string) => Promise<void> | void;
  }>;
}
