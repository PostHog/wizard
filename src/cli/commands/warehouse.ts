import { config as warehouseSourceConfig } from '@programs/warehouse-source';

import type { Command } from './command';
import { familyCommandFactory } from './factories/family-command-factory';

/**
 * The `wizard warehouse` family: `source` imports data into PostHog's data
 * warehouse, `destination` sends PostHog data to the user's own warehouse.
 * Both are wizard-native handlers in `dispatch-family.ts`. A bare
 * `wizard warehouse` runs `source`.
 */
export const warehouseCommand: Command = familyCommandFactory({
  family: 'warehouse',
  description: 'Connect data warehouse sources and destinations',
  optionsFrom: warehouseSourceConfig,
  defaultSubcommand: 'source',
});
