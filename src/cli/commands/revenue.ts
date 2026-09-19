import { revenueAnalyticsConfig } from '@store/programs';

import type { Command } from './command.js';
import { nativeCommandFactory } from './factories/native-command-factory.js';

/**
 * `wizard revenue-analytics` — flat skill command, Stripe today.
 *
 * Stays flat while there's only one provider. Restructure into a family
 * if/when a second provider lands.
 */
export const revenueCommand: Command = nativeCommandFactory(
  revenueAnalyticsConfig,
);
