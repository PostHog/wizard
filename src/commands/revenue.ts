import { revenueAnalyticsConfig } from '@lib/programs/revenue-analytics/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard revenue-analytics` — flat skill command, Stripe today.
 *
 * Stays flat while there's only one provider. Restructure into a family
 * if/when a second provider lands.
 */
export const revenueCommand: Command = nativeCommandFactory(
  revenueAnalyticsConfig,
);
