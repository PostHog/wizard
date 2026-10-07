/**
 * Who owns a flow id: a tool's TUI, else a program's (the generic skill
 * program for an id neither registry knows). Every core lookup of a flow goes
 * through here, so a tool never falls through to the skill program.
 */

import { getTuiProgram, listTuiPrograms } from '@tui/programs/index';
import { getTuiTool, listTuiTools } from '@tui/tools/index';
import type { TuiProgram } from './programs/types.js';

export function flowOwner(id: string): TuiProgram {
  return getTuiTool(id) ?? getTuiProgram(id);
}

/** Every program's and tool's TUI, for the screens each one adds. */
export function listFlowOwners(): readonly TuiProgram[] {
  return [...listTuiPrograms(), ...listTuiTools()];
}
