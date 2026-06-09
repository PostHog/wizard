/**
 * Mount an Ink picker over a command's `children` and dispatch the
 * selected child's handler.
 *
 * Used as the `interactiveDefault` for family parents like
 * `wizard audit` — when the user invokes the parent without a leaf, this
 * shows a TUI menu instead of yargs's `demandCommand(1)` help dump.
 *
 * The picker mounts a lightweight Ink app, awaits selection, unmounts
 * cleanly, then invokes the chosen child's handler with the original
 * argv. The child runs in the same process; no re-exec.
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
 * Render the picker. Resolves once the user has selected a child;
 * dispatching the child's handler is the caller's responsibility (so this
 * function stays pure-UI and easy to test by stubbing `render`).
 */
export function chooseFamilyChild(
  parentLabel: string,
  children: readonly Command[],
): Promise<Command | null> {
  const selectable = children.filter((c) => c.handler || c.children?.length);
  if (selectable.length === 0) return Promise.resolve(null);

  const options = selectable.map((child) => ({
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
 * Returns an `interactiveDefault` handler that opens the family picker over
 * a command's children and dispatches the user's selection with the
 * caller's argv.
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
    await Promise.resolve(chosen.handler?.(argv));
  };
}
