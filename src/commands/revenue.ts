import { revenueAnalyticsConfig } from '@lib/programs/revenue-analytics/index';

import type { Command } from './command';
import { flatSkillCommand } from './factories/flat-skill-command';

/**
 * `wizard revenue-analytics` — flat skill command, Stripe today. Stays
 * flat while there's only one provider. When a second provider lands,
 * this file restructures into a family (parentCommand:
 * revenue-analytics, command per vendor) and the picker opens — a
 * deliberate breaking change at that point, not silent magic
 * introduced now.
 *
 * Resolved from the manifest by skillId; falls back to the built-in
 * config if the snapshot is missing the entry (see flatSkillCommand).
 */
export const revenueCommand: Command = flatSkillCommand(
  'revenue-analytics-setup',
  revenueAnalyticsConfig,
);
