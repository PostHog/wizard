import { warehouseSourceConfig } from '@store/programs';

import type { Command } from './command.js';
import { nativeCommandFactory } from './factories/native-command-factory.js';

/**
 * `wizard warehouse` — detect and connect a data warehouse source.
 *
 * Mirrors `revenue-analytics`: flat skill command driven by the
 * warehouse-source program.
 */
export const warehouseCommand: Command = nativeCommandFactory(
  warehouseSourceConfig,
);
