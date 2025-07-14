/* eslint-disable jest/expect-expect */
import { cleanupGit, KEYS, revertLocalChanges } from '../utils';
import { startWizardInstance } from '../utils';
import {
  checkIfBuilds,
  checkIfRunsOnDevMode,
  checkIfRunsOnProdMode,
  checkPackageJson,
} from '../utils';
import * as path from 'path';

describe('NextJS', () => {
  const projectDir = path.resolve(
    __dirname,
    '../test-applications/nextjs-app-router-test-app',
  );

  beforeAll(async () => {
    const wizardInstance = startWizardInstance(projectDir);

    const regionPrompted = await wizardInstance.waitForOutput(
      'Select your PostHog Cloud region',
    );

    if (regionPrompted) {
      await wizardInstance.sendStdinAndWaitForOutput([KEYS.ENTER], 'US');
    }

    // TODO: Step through the wizard - mocking queries
    const uncommittedFilesPrompted = await wizardInstance.waitForOutput(
      'You have uncommitted or untracked files in your repo:',
    );

    if (uncommittedFilesPrompted) {
      await wizardInstance.sendStdinAndWaitForOutput(
        [KEYS.DOWN, KEYS.ENTER],
        `If the browser window didn't open automatically, please open the following link to login into PostHog:`,
        {
          timeout: 240_000,
        },
      );
    }

    // const routeThroughNextJsPrompted =
    //   packageManagerPrompted &&
    //   (await wizardInstance.sendStdinAndWaitForOutput(
    //     // Selecting `yarn` as the package manager
    //     [KEYS.DOWN, KEYS.ENTER],
    //     'Do you want to route Sentry requests in the browser through your Next.js server',
    //     {
    //       timeout: 240_000,
    //     },
    //   ));

    wizardInstance.kill();
  });

  afterAll(() => {
    revertLocalChanges(projectDir);
    cleanupGit(projectDir);
  });

  test('package.json is updated correctly', () => {
    checkPackageJson(projectDir, 'posthog-js');
    checkPackageJson(projectDir, 'posthog-node');
  });

  test('runs on dev mode correctly', async () => {
    await checkIfRunsOnDevMode(projectDir, 'Ready in');
  });

  test('builds correctly', async () => {
    await checkIfBuilds(projectDir);
  });

  test('runs on prod mode correctly', async () => {
    await checkIfRunsOnProdMode(projectDir, 'Ready in');
  });
});
