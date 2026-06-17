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
 *   - `wizard <family>` (no positional) — in an interactive terminal, runs the
 *     family's single shown entry directly (today `audit events`, so the user
 *     lands on its intro screen); opens the picker once a family shows more than
 *     one. In non-TTY/CI, falls through to `dispatchFamily`, which prints
 *     "requires a subcommand" rather than running something unprompted.
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
  // Bare `wizard <family>` in an interactive terminal. With a single option
  // today (e.g. `audit events`), skip the picker and run it directly so the
  // user lands on its own intro screen rather than a one-item menu. When a
  // family grows past one shown option, this opens the picker instead — no
  // wiring change needed.
  const openFamilyEntry = async (argv: Arguments): Promise<void> => {
    const skillsBaseUrl = getSkillsBaseUrl(Boolean(argv['local-mcp']));
    const menu = await fetchSkillMenu(skillsBaseUrl);
    const children = buildFamilyPickerChildren(family, menu?.cliEntries ?? []);
    const toShow = pickerChildrenToShow(children);
    if (toShow.length === 1 && toShow[0]?.handler) {
      await Promise.resolve(toShow[0].handler(argv));
      return;
    }
    const picker = createFamilyPickerDefault(`wizard ${family}`, toShow);
    await picker(argv);
  };

  return {
    name: `${family} [skill]`,
    description,
    options: mergeCommandOptions(optionsFrom),
    positionals: {
      skill: {
        type: 'string',
        describe: 'Subcommand to run (omit to run the default)',
      },
    },
    handler: (argv: Arguments) => {
      const sub = (argv.skill as string | undefined)?.trim();
      // With a subcommand, resolve and run it. Without one, run the family's
      // default entry (or open the picker if there's more than one) — but only
      // in an interactive terminal. In non-TTY/CI, fall through to
      // dispatchFamily, which prints "requires a subcommand" rather than
      // running something unprompted or hanging on a picker that can't render.
      if (sub || !process.stdout.isTTY) {
        void dispatchFamily(family, argv);
      } else {
        void openFamilyEntry(argv);
      }
    },
    interactiveDefault: openFamilyEntry,
  };
}
