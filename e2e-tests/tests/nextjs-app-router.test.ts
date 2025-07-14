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
import nock from 'nock';

describe('NextJS', () => {
  const projectDir = path.resolve(
    __dirname,
    '../test-applications/nextjs-app-router-test-app',
  );

  beforeAll(async () => {
    // Mock the PostHog API requests for getOrAskForProjectData
    nock('https://app.posthog.com')
      .post('/api/wizard/initialize')
      .reply(200, { hash: 'mock-wizard-hash-123' });

    nock('https://app.posthog.com')
      .get('/api/wizard/data')
      .matchHeader('X-PostHog-Wizard-Hash', 'mock-wizard-hash-123')
      .reply(200, {
        project_api_key: 'mock-project-api-key',
        host: 'https://app.posthog.com',
        user_distinct_id: 'mock-user-id',
        personal_api_key: 'mock-personal-api-key',
      });

    const wizardInstance = startWizardInstance(projectDir);

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
    nock.cleanAll();
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
