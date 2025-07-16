import { createFrameworkTest } from '../framework-test-creator';

createFrameworkTest({
  name: 'Vite',
  projectDir: 'react-vite-test-app',
  expectedOutput: {
    dev: 'ready in',
    prod: 'Local:',
  },
  tests: {
    packageJson: ['posthog-js'],
    devMode: true,
    build: true,
    prodMode: 'preview',
  },
});
