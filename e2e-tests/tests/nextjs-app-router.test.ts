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
    const wizardInstance = startWizardInstance(projectDir, true);

    const regionPrompted = await wizardInstance.waitForOutput(
      'Select your PostHog Cloud region',
    );

    if (regionPrompted) {
      await wizardInstance.sendStdinAndWaitForOutput([KEYS.ENTER], 'US');
    }

    // TODO: Step through the wizard - mocking queries
    // const uncommittedFilesPrompted = await wizardInstance.waitForOutput(
    //   'You have uncommitted or untracked files in your repo:',
    // );

    // console.log('uncommittedFilesPrompted', uncommittedFilesPrompted);

    // if (uncommittedFilesPrompted) {
    //   await wizardInstance.sendStdinAndWaitForOutput(
    //     [KEYS.DOWN, KEYS.ENTER],
    //     `If the browser window didn't open automatically, please open the following link to login into PostHog:`,
    //     {
    //       timeout: 240_000,
    //     },
    //   );
    // }
    // console.log('uncommittedFilesPrompted', uncommittedFilesPrompted);

    const mcpSetUpPrompted = await wizardInstance.waitForOutput(
      'Would you like to install the PostHog MCP server to use PostHog in your editor?',
    );

    if (mcpSetUpPrompted) {
      await wizardInstance.sendStdinAndWaitForOutput(
        [KEYS.DOWN, KEYS.ENTER],
        'No',
      );
    }

    // wizardInstance.kill();
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
