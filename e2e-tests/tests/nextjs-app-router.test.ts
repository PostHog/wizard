import { createFrameworkTest } from '../framework-test-creator';

createFrameworkTest({
  name: 'NextJS',
  projectDir: 'nextjs-app-router-test-app',
  expectedOutput: {
    dev: 'Ready in',
    prod: 'Ready in',
  },
  tests: {
    packageJson: ['posthog-js', 'posthog-node'],
    devMode: true,
    build: true,
    prodMode: 'start',
  },
});
