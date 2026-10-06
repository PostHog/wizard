/**
 * Core screen ids + per-program screen sequences.
 *
 * Owns the core ScreenId enum and projects a program's flow into the
 * router-shaped screen sequence (filtering headless steps and appending the
 * exit screen). No store, no React, and no program by name.
 */

import type { TuiView } from '@tui/tui-state';
import type { ProgramId } from '@programs';
import { createProgramSequence } from './flow.js';
import { programFlowSteps } from './ai-opt-in-gate.js';
import { ScreenId } from './screen-ids.js';

export { ScreenId };

export interface Screen {
  /** Screen to show: a core `ScreenId` or a program's own screen id. */
  id: string;
  /** If provided, screen is skipped when this returns false. Omit = always show. */
  show?: (view: TuiView) => boolean;
  /** If provided, screen is considered complete when this returns true. */
  isComplete?: (view: TuiView) => boolean;
}

/** An ordered list of screens — a program's screen journey. */
export type Sequence = Screen[];

/** Post-run steps a mint-failure handoff continues through; ends on exit. */
export const MINT_HANDOFF_SEQUENCE: Sequence = [
  { id: ScreenId.Mcp, isComplete: (s) => s.mcpComplete },
  { id: ScreenId.KeepSkills, isComplete: (s) => s.skillsComplete },
  { id: ScreenId.Exit },
];

/** A program's or a tool's screen sequence: its flow's screens, a program's AI opt-in gate, then exit. */
export function programSequence(programId: ProgramId): Sequence {
  return createProgramSequence(programFlowSteps(programId));
}
