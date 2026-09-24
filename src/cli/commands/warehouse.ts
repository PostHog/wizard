import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';
import { warehouseSourceConfig } from '@programs';

/**
 * `wizard warehouse` — detect and connect a data warehouse source.
 *
 * Mirrors `revenue-analytics`: flat skill command driven by the
 * warehouse-source program.
 */
export const warehouseCommand: Command = nativeCommandFactory(
  warehouseSourceConfig,
);
