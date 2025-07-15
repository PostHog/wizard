import { fixtureTracker } from './mocks/fixture-tracker';

export default function globalSetup() {
  // eslint-disable-next-line no-console
  console.log('Global setup: Capturing existing fixtures...');
  fixtureTracker.captureExistingFixtures();
}
