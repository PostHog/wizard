import { warehouseSourceConfig } from '@lib/programs/warehouse-source/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard warehouse` — detect and connect a data warehouse source.
 *
 * Mirrors `revenue-analytics`: flat skill command driven by the
 * warehouse-source program.
 */
export const warehouseCommand: Command = nativeCommandFactory(
  warehouseSourceConfig,
);
