import { fixtureTracker } from './mocks/fixture-tracker';

export default function globalTeardown() {
  // eslint-disable-next-line no-console
  console.log('Global teardown: Cleaning up unused fixtures...');

  // Clean up unused fixtures after all tests complete
  if (process.env.CLEANUP_UNUSED_FIXTURES !== 'false') {
    // fixtureTracker.cleanupUnusedFixtures();

    // Log statistics for debugging
    const stats = fixtureTracker.getStats();
    // eslint-disable-next-line no-console
    console.log(
      `Fixture usage stats: ${stats.usedFixtures}/${stats.existingFixtures} fixtures used, ${stats.unusedFixtures} deleted`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.log('Fixture cleanup disabled by CLEANUP_UNUSED_FIXTURES=false');
  }
}
