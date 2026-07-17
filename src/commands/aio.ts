import { aioConfig } from '@lib/programs/aio/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard aio` — flat skill command for AI observability (LLM analytics).
 *
 * Mirrors the `revenue-analytics` shape: a one-liner wrapping the program
 * config. The default integration flow still offers AI observability as an
 * opt-in add-on; this command runs the same setup standalone.
 */
export const aioCommand: Command = nativeCommandFactory(aioConfig);
