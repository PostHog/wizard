import { fixtureTracker } from './mocks/fixture-tracker';

export default function globalTeardown() {
  if (process.env.CLEANUP_UNUSED_FIXTURES !== 'false') {
    fixtureTracker.cleanupUnusedFixtures();

    const stats = fixtureTracker.getStats();

    // eslint-disable-next-line no-console
    console.log(
      `Fixture usage stats: ${stats.usedFixtures}/${stats.existingFixtures} fixtures used, ${stats.unusedFixtures} deleted`,
    );
  }
}
