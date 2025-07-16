import { fixtureTracker } from './mocks/fixture-tracker';

export default function globalTeardown() {
  // Clean up unused fixtures after all tests complete
  if (process.env.CLEANUP_UNUSED_FIXTURES !== 'false') {
    fixtureTracker.cleanupUnusedFixtures();

    // Log statistics for debugging
    const stats = fixtureTracker.getStats();
    // eslint-disable-next-line no-console
    console.log(
      `Fixture usage stats: ${stats.usedFixtures}/${stats.existingFixtures} fixtures used, ${stats.unusedFixtures} deleted`,
    );
  }
}
