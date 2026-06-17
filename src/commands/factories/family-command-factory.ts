import type { Arguments } from 'yargs';

import type { ProgramConfig } from '@lib/programs/program-step';
import {
  buildFamilyPickerChildren,
  dispatchFamily,
  pickerChildrenToShow,
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
 *   - `wizard <family>` (no positional) — in an interactive terminal, opens the
 *     family picker (`openPicker`). For now the picker surfaces only the leaf
 *     marked `default` (e.g. `audit events`); the others stay runnable directly.
 *     In non-TTY/CI, falls through to `dispatchFamily`, which prints
 *     "requires a subcommand" rather than hanging on a picker that can't render.
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
  const openPicker = async (argv: Arguments): Promise<void> => {
    const skillsBaseUrl = getSkillsBaseUrl(Boolean(argv['local-mcp']));
    const menu = await fetchSkillMenu(skillsBaseUrl);
    const children = buildFamilyPickerChildren(family, menu?.cliEntries ?? []);
    // Today the picker surfaces only the default leaf (e.g. `audit events`);
    // other subcommands stay runnable directly. See `pickerChildrenToShow`.
    const pickerChildren = pickerChildrenToShow(children);
    const picker = createFamilyPickerDefault(
      `wizard ${family}`,
      pickerChildren,
    );
    await picker(argv);
  };

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
      const sub = (argv.skill as string | undefined)?.trim();
      // With a subcommand, resolve and run it. Without one, open the picker —
      // but only in an interactive terminal. In non-TTY/CI, fall through to
      // dispatchFamily, which prints "requires a subcommand" rather than hanging
      // on an Ink picker that can't render.
      if (sub || !process.stdout.isTTY) {
        void dispatchFamily(family, argv);
      } else {
        void openPicker(argv);
      }
    },
    interactiveDefault: openPicker,
  };
}
