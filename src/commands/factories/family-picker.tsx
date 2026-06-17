/**
 * Mount an Ink picker over a command's `children` and dispatch the
 * selected child's handler.
 *
 * Used as the `interactiveDefault` for family parents like
 * `wizard audit` — when the user invokes the parent without a leaf, this
 * shows a TUI menu instead of yargs's `demandCommand(1)` help dump.
 *
 * The picker opens for families in an interactive terminal; the `default`
 * flag on a child controls which option is pre-highlighted (so `wizard audit`
 * → Enter runs the default leaf, today `audit events`). The caller decides
 * which children to pass in — `familyCommandFactory` currently passes only the
 * default leaf, so other subcommands stay runnable directly but aren't listed
 * here yet.
 *
 * Single-option commands aren't families — they should be flat
 * commands wired with `skillCommandFactory` / `nativeCommandFactory`
 * directly, not run through this module.
 */

import type { Arguments } from 'yargs';
import { Box, Text, render } from 'ink';
import { createElement } from 'react';

import { Colors } from '@ui/tui/styles';
import { PickerMenu } from '@ui/tui/primitives/PickerMenu';

import { commandKeys, type Command } from '../command';

interface FamilyPickerAppProps {
  parentLabel: string;
  options: { label: string; value: Command; hint?: string }[];
  onSelect: (cmd: Command) => void;
}

function FamilyPickerApp(props: FamilyPickerAppProps) {
  return createElement(
    Box,
    { flexDirection: 'column', paddingX: 1, paddingY: 1 },
    createElement(
      Text,
      { bold: true, color: Colors.accent },
      props.parentLabel,
    ),
    createElement(Box, { height: 1 }),
    createElement(PickerMenu<Command>, {
      message: 'Pick a subcommand',
      options: props.options,
      optionMarginBottom: 1,
      onSelect: (value) => {
        // PickerMenu in single mode returns one value; only the multi-mode
        // signature is the array variant. Narrow defensively.
        const cmd = Array.isArray(value) ? value[0] : value;
        if (cmd) props.onSelect(cmd);
      },
    }),
  );
}

function describe(child: Command): string {
  // Strip positional syntax (`search <query>` → `search`) for the picker label.
  return commandKeys(child.name)[0] ?? '';
}

/**
 * Reorder children so the `default`-marked entry is first, while
 * preserving the relative order of the rest. The picker's initial
 * focus is index 0, so this is what makes "press Enter on
 * `wizard audit`" run the default leaf (today `audit events`).
 *
 * Exported for testability — the ordering logic stays pure and
 * inspectable without mounting Ink.
 */
export function orderFamilyChildren(children: readonly Command[]): Command[] {
  const selectable = children.filter((c) => c.handler || c.children?.length);
  const defaults = selectable.filter((c) => c.default);
  const rest = selectable.filter((c) => !c.default);
  return [...defaults, ...rest];
}

/**
 * Render the picker. Resolves once the user has selected a child;
 * dispatching the child's handler is the caller's responsibility (so this
 * function stays pure-UI and easy to test by stubbing `render`).
 */
export function chooseFamilyChild(
  parentLabel: string,
  children: readonly Command[],
): Promise<Command | null> {
  const ordered = orderFamilyChildren(children);
  if (ordered.length === 0) return Promise.resolve(null);

  const options = ordered.map((child) => ({
    label: describe(child),
    value: child,
    hint: child.description,
  }));

  return new Promise((resolve) => {
    let app: ReturnType<typeof render> | null = null;
    const handleSelect = (cmd: Command): void => {
      app?.unmount();
      resolve(cmd);
    };
    app = render(
      createElement(FamilyPickerApp, {
        parentLabel,
        options,
        onSelect: handleSelect,
      }),
    );
  });
}

/**
 * Returns an `interactiveDefault` handler for a family parent's no-leaf
 * invocation. Always opens the picker; the `default`-marked child is
 * shown first (pre-highlighted), so a single Enter keystroke runs it.
 *
 * Discovery + consent in one extra keystroke vs. auto-running silently.
 *
 * Wire onto a family parent:
 *   export const auditCommand: Command = {
 *     name: 'audit',
 *     description: '...',
 *     children: [...],
 *     interactiveDefault: createFamilyPickerDefault('audit', auditChildren),
 *   };
 */
export function createFamilyPickerDefault(
  parentLabel: string,
  children: readonly Command[],
  chooser: (
    label: string,
    children: readonly Command[],
  ) => Promise<Command | null> = chooseFamilyChild,
): (argv: Arguments) => Promise<void> {
  return async (argv) => {
    const chosen = await chooser(parentLabel, children);
    if (!chosen) return;
    // We forward the PARENT's parsed argv straight to the chosen child. The
    // child's own option defaults and `check` validator do NOT run on this
    // path — they only run when the leaf is invoked directly
    // (`wizard audit events`). Harmless while leaves declare neither, but if a
    // leaf ever grows a `check` or a defaulted option, this path will skip it.
    await Promise.resolve(chosen.handler?.(argv));
  };
}
