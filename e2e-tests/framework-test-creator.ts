import * as path from 'path';
import { cleanupGit, revertLocalChanges, startWizardInstance } from './utils';
import {
  checkIfBuilds,
  checkIfRunsOnDevMode,
  checkIfRunsOnProdMode,
  checkPackageJson,
} from './utils';
import type { FrameworkTestConfig } from './utils/framework-test-types';
import { DEFAULT_WIZARD_STEPS } from './utils/framework-test-utils';

export function createFrameworkTest(config: FrameworkTestConfig): void {
  const projectDir = path.resolve(
    __dirname,
    'test-applications',
    config.projectDir,
  );

  describe(config.name, () => {
    beforeAll(async () => {
      if (config.hooks?.beforeWizard) {
        await config.hooks.beforeWizard();
      }

      const wizardInstance = startWizardInstance(projectDir, true);

      // Get the wizard steps to execute
      const wizardSteps = config.customWizardSteps || DEFAULT_WIZARD_STEPS;

      // Insert additional steps if specified
      const finalSteps = [...wizardSteps];
      if (config.additionalSteps) {
        for (const addition of config.additionalSteps) {
          if (addition.before) {
            const index = finalSteps.findIndex(
              (step) => step.name === addition.before,
            );
            if (index !== -1) {
              finalSteps.splice(index, 0, ...addition.steps);
            }
          } else if (addition.after) {
            const index = finalSteps.findIndex(
              (step) => step.name === addition.after,
            );
            if (index !== -1) {
              finalSteps.splice(index + 1, 0, ...addition.steps);
            }
          }
        }
      }

      // Execute wizard steps
      for (const step of finalSteps) {
        if (step.condition && !step.condition(wizardInstance)) {
          continue;
        }

        const prompted = await wizardInstance.waitForOutput(step.waitFor, {
          timeout:
            step.timeout || process.env.RECORD_FIXTURES === 'true'
              ? 240 * 1000
              : 10 * 1000,
          optional: step.optional,
        });

        if (prompted && step.response) {
          if (step.responseWaitFor) {
            await wizardInstance.sendStdinAndWaitForOutput(
              step.response,
              step.responseWaitFor,
              {
                timeout:
                  step.timeout || process.env.RECORD_FIXTURES === 'true'
                    ? 240 * 1000
                    : 10 * 1000,
              },
            );
          } else {
            wizardInstance.sendStdin(step.response);
          }
        }
      }

      wizardInstance.kill();
      if (config.hooks?.afterWizard) {
        await config.hooks.afterWizard();
      }
    });

    afterAll(async () => {
      if (config.hooks?.beforeTests) {
        await config.hooks.beforeTests();
      }
      revertLocalChanges(projectDir);
      cleanupGit(projectDir);
      if (config.hooks?.afterTests) {
        await config.hooks.afterTests();
      }
    });

    // Standard tests
    if (config.tests?.packageJson && config.tests.packageJson.length > 0) {
      test('package.json is updated correctly', () => {
        const packageJsonTests = config.tests?.packageJson;
        if (packageJsonTests) {
          for (const packageName of packageJsonTests) {
            checkPackageJson(projectDir, packageName);
          }
        }
      });
    }

    if (config.tests?.devMode !== false) {
      test('runs on dev mode correctly', async () => {
        await checkIfRunsOnDevMode(projectDir, config.expectedOutput.dev);
      });
    }

    if (config.tests?.build !== false) {
      test('builds correctly', async () => {
        await checkIfBuilds(projectDir);
      });
    }

    if (config.tests?.prodMode !== false) {
      const prodCommand =
        typeof config.tests?.prodMode === 'string'
          ? config.tests.prodMode
          : 'start';
      const prodOutput =
        config.expectedOutput.prod || config.expectedOutput.dev;

      test('runs on prod mode correctly', async () => {
        await checkIfRunsOnProdMode(projectDir, prodOutput, prodCommand);
      });
    }

    // Custom tests
    if (config.customTests) {
      for (const customTest of config.customTests) {
        const testName = String(customTest.name);
        test(testName, async () => {
          await customTest.fn(projectDir);
        });
      }
    }
  });
}
