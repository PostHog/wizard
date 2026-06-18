import { auditConfig } from '@lib/programs/audit/index';

import type { Command } from './command';
import { familyCommandFactory } from './factories/family-command-factory';

/**
 * The `wizard audit` family.
 *
 * Subcommands are resolved at runtime: the wizard fetches `cliEntries` from
 * `skill-menu.json` and dispatches based on `parentCommand: 'audit'`. The
 * wizard-native handler for `web-analytics` lives in `NATIVE_HANDLERS` over
 * in `dispatch-family.ts`. `wizard audit` with no positional opens the
 * family picker, which combines native + live entries.
 *
 * Adding a new skill-backed audit subcommand is a context-mill release —
 * no wizard release needed.
 */
export const auditCommand: Command = familyCommandFactory({
  family: 'audit',
  description: auditConfig.description,
  optionsFrom: auditConfig,
});
