/**
 * Screen taxonomy + per-program screen sequences.
 *
 * Owns the ScreenId enum and projects each registered program's steps
 * into the router-shaped screen sequence (filtering headless steps and
 * appending the exit screen). Pure leaf module — no store, no React.
 */

import type { WizardSession } from '@programs/session/wizard-session';
import { PROGRAM_REGISTRY, type ProgramId } from '@programs';
import { createProgramSequence } from '@tui/flow';
import { withAiOptInGate } from '@tui/ai-opt-in-gate';
import { ScreenId } from '@tui/screen-ids';

export { ScreenId };

export interface Screen {
  /** ScreenId to show */
  id: ScreenId;
  /** If provided, screen is skipped when this returns false. Omit = always show. */
  show?: (session: WizardSession) => boolean;
  /** If provided, screen is considered complete when this returns true. */
  isComplete?: (session: WizardSession) => boolean;
}

/** An ordered list of screens — a program's screen journey. */
export type Sequence = Screen[];

/** Post-run steps a mint-failure handoff continues through; ends on exit. */
export const MINT_HANDOFF_SEQUENCE: Sequence = [
  { id: ScreenId.Mcp, isComplete: (s) => s.mcpComplete },
  { id: ScreenId.KeepSkills, isComplete: (s) => s.skillsComplete },
  { id: ScreenId.Exit },
];

/** All program screen sequences keyed by program id. */
export const PROGRAM_SEQUENCES: Record<ProgramId, Sequence> =
  Object.fromEntries(
    PROGRAM_REGISTRY.map((c) => [
      c.id,
      createProgramSequence(withAiOptInGate(c)) as Sequence,
    ]),
  ) as Record<ProgramId, Sequence>;
