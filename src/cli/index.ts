/** The CLI's one entry: `bin.ts` runs the `wizard` command line through it. */
import { wizardCommands } from './commands';
import { Wizard } from './wizard';

/** Register every command and run the one `process.argv` names. */
export function runCli(): void {
  Wizard.use(...wizardCommands()).init();
}
