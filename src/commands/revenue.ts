import { CLI_MANIFEST } from '@lib/programs/cli-manifest.generated';
import { revenueAnalyticsConfig } from '@lib/programs/revenue-analytics/index';

import type { Command } from './command';
import { skillCommandFactory } from './factories/skill-command-factory';

/**
 * `wizard revenue-analytics` — flat skill command, Stripe today. Stays
 * flat while there's only one provider. When a second provider lands,
 * this file restructures into a family (parentCommand:
 * revenue-analytics, command per vendor) and the picker opens — a
 * deliberate breaking change at that point, not silent magic
 * introduced now.
 */
const revenueEntry = CLI_MANIFEST.entries.find(
  (entry) =>
    entry.role === 'command' &&
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
