import yargs from 'yargs';
import type { Arguments } from 'yargs';
import { GLOBAL_OPTIONS } from '../../wizard';
import { toCommandModule, type Command } from '../../commands/command';

/**
 * Parse an argv string through a command's real yargs configuration (global
 * options + the command's own options/children) and resolve with the
 * Arguments the matched handler would receive. Real handlers are swapped for
 * a capture, so no side effects run.
 *
 * This exercises the yargs layer — option naming/camelCasing, aliases,
 * choices, conflicts — that direct-handler tests skip. Renaming an option in
 * a spec without updating its handler would slip past a direct-handler test
 * but fail here.
 */
export function parseCommand(cmd: Command, argv: string): Promise<Arguments> {
  return new Promise((resolve, reject) => {
    yargs(argv.split(/\s+/).filter(Boolean))
      .options(GLOBAL_OPTIONS)
      .command(toCommandModule(withCapture(cmd, resolve), []))
      .fail((msg, err) => reject(err ?? new Error(msg)))
      .exitProcess(false)
      .parse();
  });
}

/** Recursively replace every command's handler with the capture callback. */
function withCapture(
  cmd: Command,
  capture: (argv: Arguments) => void,
): Command {
  return {
    ...cmd,
    handler: cmd.handler ? capture : undefined,
    children: cmd.children?.map((c) => withCapture(c, capture)),
  };
}
