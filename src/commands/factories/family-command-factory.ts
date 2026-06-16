import type { Arguments } from 'yargs';

import type { ProgramConfig } from '@lib/programs/program-step';
import {
  buildFamilyPickerChildren,
  dispatchFamily,
} from '@lib/programs/dispatch-family';
import { getSkillsBaseUrl } from '@lib/constants';
import { fetchSkillMenu } from '@lib/wizard-tools';

import type { Command } from '../command';
import { createFamilyPickerDefault } from './family-picker';
import { mergeCommandOptions } from './shared';

export interface FamilyCommandFactoryOpts {
  /** The family's CLI name (e.g. 'audit'). */
  family: string;
  /** Help text for `wizard <family> --help`. */
  description: string;
  /**
   * Source for shared CLI options (e.g. --install-dir) merged onto the
   * family parent. Usually the family's flagship native config, or the
   * generic agent-skill config.
   */
  optionsFrom: ProgramConfig;
}

/**
 * Build a yargs `Command` for a family parent (`wizard audit`, etc.).
 *
 *   - `wizard <family> <sub>` — `dispatchFamily` resolves `<sub>` against
 *     native handlers first, then the live `cliEntries` from
 *     `skill-menu.json`. Unknown subs error with the available list.
 *   - `wizard <family>` (no positional) — `interactiveDefault` fetches the
 *     registry, builds a children list combining native + live entries, and
 *     opens the family picker. The default leaf (if any) is
 *     pre-highlighted.
 *
 * No static yargs children. New skill-backed subcommands appear after a
 * context-mill release without a wizard release. New *native* subcommands
 * (rare) are added by updating `NATIVE_HANDLERS` in `dispatch-family.ts`.
 */
export function familyCommandFactory({
  family,
  description,
  optionsFrom,
}: FamilyCommandFactoryOpts): Command {
  return {
    name: `${family} [skill]`,
    description,
    options: mergeCommandOptions(optionsFrom),
    positionals: {
      skill: {
        type: 'string',
        describe: 'Subcommand to run (omit to open the interactive picker)',
      },
    },
    handler: (argv: Arguments) => {
      void dispatchFamily(family, argv);
    },
    interactiveDefault: async (argv: Arguments) => {
      const skillsBaseUrl = getSkillsBaseUrl(Boolean(argv['local-mcp']));
      const menu = await fetchSkillMenu(skillsBaseUrl);
      const children = buildFamilyPickerChildren(
        family,
        menu?.cliEntries ?? [],
      );
      const picker = createFamilyPickerDefault(`wizard ${family}`, children);
      await picker(argv);
    },
  };
}
