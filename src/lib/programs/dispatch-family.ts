import type { Arguments } from 'yargs';

import { auditConfig } from '@lib/programs/audit/index';
import { agentSkillConfig } from '@lib/programs/program-registry';
import { webAnalyticsDoctorConfig } from '@lib/programs/web-analytics-doctor/index';
import type { ProgramConfig } from '@lib/programs/program-step';
import { getSkillsBaseUrl } from '@lib/constants';
import { fetchSkillMenu, type CliEntry } from '@lib/wizard-tools';
import { analytics } from '@utils/analytics';

import { dispatchProgram } from '../../commands/factories/shared';
import type { Command } from '../../commands/command';

/**
 * Capture a CLI dispatch error, flush analytics, and exit. The wizard never
 * starts a run from these paths — use flush() (not shutdown()) so we don't
 * fire a "setup wizard finished" event for a parse error that didn't run.
 */
async function exitDispatchError(
  reason: string,
  properties: Record<string, unknown>,
  message: string,
  code = 1,
): Promise<never> {
  analytics.wizardCapture('cli dispatch error', { reason, ...properties });
  try {
    await analytics.flush();
  } catch {
    /* flush is best-effort; never block the exit */
  }
  process.stderr.write(message);
  return process.exit(code);
}

/**
 * Family commands (`wizard audit`, `wizard migrate`, ...) resolve their
 * subcommands at runtime against the published `cliEntries` inside
 * `skill-menu.json`. Adding a subcommand is a context-mill release — no
 * wizard release needed.
 *
 * Wizard-native subcommands (programs that aren't backed by a single skill,
 * e.g. `wizard audit web-analytics`) live here in code, dispatched directly
 * without touching the registry. Adding a native is a wizard PR.
 */

/** Wizard-native subcommands keyed by family. */
const NATIVE_HANDLERS: Record<string, Record<string, ProgramConfig>> = {
  audit: { 'web-analytics': webAnalyticsDoctorConfig },
};

/**
 * Resolve a fetched CliEntry to the ProgramConfig that actually runs it.
 * Most entries run via the generic agent-skill program with the entry's
 * `skillId` injected. The comprehensive `audit all` is the one exception —
 * skillId 'audit' triggers the specialized auditConfig (custom hooks,
 * content blocks, screens).
 */
function configForCliEntry(entry: CliEntry): ProgramConfig {
  if (entry.skillId === 'audit') return auditConfig;
  return { ...agentSkillConfig, skillId: entry.skillId };
}

function familyEntries(family: string, entries: CliEntry[]): CliEntry[] {
  return entries.filter(
    (e) =>
      e.role === 'command' && e.parentCommand === family && Boolean(e.command),
  );
}

/**
 * Dispatch `wizard <family> <sub>` to the right program.
 *
 * Order:
 *   1. Native handler for (family, sub) — runs immediately, no network.
 *   2. Fetched CliEntry — runs the resolved skill.
 *   3. Unknown — prints the available list and exits non-zero.
 */
export async function dispatchFamily(
  family: string,
  argv: Arguments,
): Promise<void> {
  const sub = (argv.skill as string | undefined)?.trim();
  if (!sub) {
    // Reached only in non-TTY/CI — an interactive terminal routes the no-sub
    // case to the picker before this runs, so don't suggest opening it here.
    return exitDispatchError(
      'missing subcommand',
      { family },
      `\n\x1b[1;91m✖ \`wizard ${family}\` requires a subcommand.\x1b[0m\n` +
        `  Pass one (e.g. \`wizard ${family} <subcommand>\`), or run it in an interactive terminal to pick from a menu.\n\n`,
    );
  }

  const native = NATIVE_HANDLERS[family]?.[sub];
  if (native) {
    dispatchProgram(native, argv);
    return;
  }

  const skillsBaseUrl = getSkillsBaseUrl(Boolean(argv['local-mcp']));
  const menu = await fetchSkillMenu(skillsBaseUrl);
  if (!menu) {
    return exitDispatchError(
      'registry unreachable',
      { family, sub, skillsBaseUrl },
      `\n\x1b[1;91m✖ Couldn't reach the skill registry at ${skillsBaseUrl}.\x1b[0m\n` +
        `  Check your network connection and try again.\n\n`,
    );
  }

  const entries = menu.cliEntries ?? [];
  const entry = familyEntries(family, entries).find((e) => e.command === sub);
  if (entry) {
    dispatchProgram(configForCliEntry(entry), argv);
    return;
  }

  const available = [
    ...Object.keys(NATIVE_HANDLERS[family] ?? {}),
    ...familyEntries(family, entries).map((e) => e.command!),
  ].sort();
  return exitDispatchError(
    'unknown subcommand',
    { family, sub, available },
    `\n\x1b[1;91m✖ Unknown subcommand "${sub}" under \`${family}\`.\x1b[0m\n` +
      (available.length
        ? `  Available: ${available.join(', ')}\n\n`
        : `  No subcommands published for "${family}" yet.\n\n`),
  );
}

/**
 * Build the children list shown in the family's interactive picker.
 * Combines native handlers with skill-backed entries from the live registry.
 * Used by `familyCommandFactory`'s `interactiveDefault`.
 */
export function buildFamilyPickerChildren(
  family: string,
  entries: CliEntry[],
): Command[] {
  const natives: Command[] = Object.entries(NATIVE_HANDLERS[family] ?? {}).map(
    ([cmd, program]) => ({
      name: cmd,
      description: program.description,
      handler: (argv: Arguments) => dispatchProgram(program, argv),
    }),
  );
  const live: Command[] = familyEntries(family, entries).map((entry) => ({
    name: entry.command!,
    description: entry.description,
    handler: (argv: Arguments) => {
      void dispatchFamily(family, {
        ...argv,
        skill: entry.command,
      } as Arguments);
    },
    default: entry.default,
  }));
  return [...natives, ...live];
}

/**
 * The children the family picker shows **today**: only the leaf marked
 * `default` (e.g. `audit events`). Every other subcommand stays runnable
 * directly (`wizard audit <name>`) — they just aren't listed in the picker yet.
 * Falls back to all children when nothing is marked `default`.
 *
 * Temporary: when we're ready to surface the full menu, return `children`
 * unchanged (and delete this note).
 */
export function pickerChildrenToShow(children: readonly Command[]): Command[] {
  const defaults = children.filter((c) => c.default);
  return defaults.length > 0 ? [...defaults] : [...children];
}
