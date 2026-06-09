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
 * Pick the "no-leaf default" for a family parent. Decision order:
 *
 *  1. Single child with a handler → that child (no picker, no prompt).
 *  2. A child marked `default: true` → that child.
 *  3. Otherwise → null (caller should open the picker).
 *
 * Exported for unit tests and for any caller that wants the resolution
 * logic without the picker fallback (e.g. `--ci` mode where picker
 * doesn't make sense).
 */
export function pickFamilyDefault(
  children: readonly Command[],
): Command | null {
  const handlerChildren = children.filter((c) => c.handler);
  if (handlerChildren.length === 1) return handlerChildren[0];
  const marked = handlerChildren.filter((c) => c.default);
  if (marked.length === 1) return marked[0];
  return null;
}

/**
 * Returns an `interactiveDefault` handler for a family parent's no-leaf
 * invocation. Runs the default child if one resolves; otherwise opens
 * the picker.
 *
 * Resolution order matches `pickFamilyDefault`: single child → marked
 * default → picker. Adding a non-default child to a family later won't
 * change what `wizard <family>` does, so existing users keep getting
 * the same behavior.
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
    const resolved = pickFamilyDefault(children);
    if (resolved) {
      await Promise.resolve(resolved.handler?.(argv));
      return;
    }
    const chosen = await chooser(parentLabel, children);
    if (!chosen) return;
    await Promise.resolve(chosen.handler?.(argv));
  };
}
