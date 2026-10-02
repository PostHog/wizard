/**
 * What a tool's TUI entry (`tools/<id>/index.ts`) gives the TUI: the same
 * shape as a program's, plus the work its flow's gates wait on. The core reads
 * these through the tool registry and names no tool.
 */

import type { ToolId } from '@tools';
import type { TuiProgram } from '../programs/types.js';
import type { WizardStore } from '../store.js';

/** What a tool's `start` works with. */
export type TuiToolContext = {
  store: WizardStore;
  /** Log in through the auth screen. */
  logIn(): Promise<void>;
  signal: AbortSignal;
};

export type TuiTool = TuiProgram & {
  /** Work the flow waits on, as doctor's login once its intro and health check pass. Unset: the screens do it all. */
  start?(ctx: TuiToolContext): Promise<void>;
};

/** A TUI tool folder's entry: the TUI tool for each tool id it serves. */
export type TuiTools = Partial<Record<ToolId, TuiTool>>;
