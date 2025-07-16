import { fixtureTracker } from './mocks/fixture-tracker';

export default function globalSetup() {
  fixtureTracker.captureExistingFixtures();
}
