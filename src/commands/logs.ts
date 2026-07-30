import { logsConfig } from '@lib/programs/logs/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard logs` — flat skill command, send this project's logs to PostHog and
 * link them back to the people and sessions that produced them.
 *
 * Installs the OpenTelemetry log export alongside the project's existing
 * logging, then does the part the docs can't: finds where the app already
 * knows who a request belongs to and attaches `posthogDistinctId` and
 * `sessionId` to every log record from a single place. The `logs-setup`
 * context-mill skill has one variant per runtime; the agent picks the right
 * one at run time by reading the project's manifest, and asks via
 * `wizard_ask` when a repo holds both a frontend and a backend.
 *
 * Named for the product, per context-mill's CLI naming convention — the verb
 * is implied by the wizard, as in `revenue-analytics` and `ai-observability`.
 * Stays flat while "set up logs for this project" is the only action.
 */
export const logsCommand: Command = nativeCommandFactory(logsConfig);
