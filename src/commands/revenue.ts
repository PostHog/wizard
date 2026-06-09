import { CLI_MANIFEST } from '@lib/programs/cli-manifest.generated';
import { revenueAnalyticsConfig } from '@lib/programs/revenue-analytics/index';

import type { Command } from './command';
import { skillCommandFactory } from './factories/skill-command-factory';

/**
 * `wizard revenue` — flat for now (Stripe is the only provider). When a
 * second provider lands, this becomes a `wizard revenue <provider>`
 * family just like `migrate`, derived from the same manifest pattern.
 */
const revenueEntry = CLI_MANIFEST.entries.find(
  (entry) =>
    entry.surface === 'public' &&
    !entry.parentCommand &&
    entry.skillId === 'revenue-analytics-setup',
);

if (!revenueEntry) {
  throw new Error(
    'commands/revenue: no public `revenue-analytics-setup` entry in CLI_MANIFEST. ' +
      'Check cli-manifest.bootstrap.json or the latest context-mill release.',
  );
}

export const revenueCommand: Command = skillCommandFactory(
  revenueEntry,
  revenueAnalyticsConfig,
);
