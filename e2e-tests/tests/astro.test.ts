/* eslint-disable jest/expect-expect */
import { cleanupGit, revertLocalChanges } from '../utils';
import { startWizardInstance } from '../utils';
import {
	checkIfBuilds,
	checkIfRunsOnDevMode,
	checkIfRunsOnProdMode,
} from "../utils";
import * as path from 'node:path';

describe('Astro', () => {
  const projectDir = path.resolve(
    __dirname,
    '../test-applications/astro-test-app',
  );

  beforeAll(() => {
    const wizardInstance = startWizardInstance(projectDir);

    wizardInstance.kill();
  });

  afterAll(() => {
    revertLocalChanges(projectDir);
    cleanupGit(projectDir);
  });

  test('runs on dev mode correctly', async () => {
    await checkIfRunsOnDevMode(projectDir, 'Local:');
  });

  test('builds correctly', async () => {
    await checkIfBuilds(projectDir);
  });

  test('runs on preview mode correctly', async () => {
    await checkIfRunsOnProdMode(projectDir, 'Local:', 'preview');
  });
});
