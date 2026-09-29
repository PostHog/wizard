/**
 * The TUI tool registry: each tool's screens, gathered from its folder's entry
 * (`tools/<id>/index.ts`). The core reaches this module only through
 * `getTuiTool` and `listTuiTools`, and names no tool; a tool folder never
 * imports it.
 */

import type { TuiTool, TuiTools } from './types.js';
import { TUI_TOOLS as doctor } from '@tui/tools/doctor';
import { TUI_TOOLS as mcp } from '@tui/tools/mcp';
import { TUI_TOOLS as slack } from '@tui/tools/slack';

export type { TuiTool };

const TUI_TOOLS: Readonly<Record<string, TuiTool | undefined>> = {
  ...doctor,
  ...mcp,
  ...slack,
} satisfies TuiTools;

/** The tool's TUI, or undefined for a program's id. */
export function getTuiTool(id: string): TuiTool | undefined {
  return Object.hasOwn(TUI_TOOLS, id) ? TUI_TOOLS[id] : undefined;
}

/** Every TUI tool. */
export function listTuiTools(): readonly TuiTool[] {
  return Object.values(TUI_TOOLS).filter(
    (tool): tool is TuiTool => tool !== undefined,
  );
}

/** Every screen id a tool mounts, for tests that walk all screens. */
export function toolScreenIds(): string[] {
  return [
    ...new Set(listTuiTools().flatMap((t) => Object.keys(t.screens ?? {}))),
  ];
}
