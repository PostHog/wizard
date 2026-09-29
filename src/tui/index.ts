/** The TUI's one entry for other layers; each function loads its module on first call. */
import type { ProgramId } from '@programs';
import type { SessionArgs, ProgramConfig } from '@programs/types';
import type { ControlTarget } from '@shared/control/types';
import type { ToolId } from '@tools';
import type { FamilyPickerOption } from './family-picker.js';
import type { FlowStep } from './flow.js';
import type { TuiLaunch, TuiToolLaunch } from './launch.js';
import type { TuiLaunchChoices } from './tui-state.js';

export { Overlay, ScreenId } from './screen-ids.js';
// The programs' screen ids, from their leaf modules so the entry stays light.
export { AuditScreenId } from './programs/audit/screen-ids.js';
export { SourceMapsScreenId } from './programs/error-tracking-upload-source-maps/screen-ids.js';
export { PostHogIntegrationScreenId } from './programs/posthog-integration/screen-ids.js';
export { SelfDrivingScreenId } from './programs/self-driving/screen-ids.js';
export type { FamilyPickerOption } from './family-picker.js';
export type { FlowStep } from './flow.js';
export type { TuiControlAttach, TuiLaunch, TuiToolLaunch } from './launch.js';
export type { TuiLaunchChoices } from './tui-state.js';

/** Run `config` in the TUI; resolves with the exit code. */
export async function runTui(
  config: ProgramConfig,
  launch: TuiLaunch,
): Promise<number> {
  const { runTui: run } = await import('./run.js');
  return run(config, launch);
}

/** Run a tool's screens; resolves with the exit code, rejects when the TUI cannot start. */
export async function runTuiTool(
  toolId: ToolId,
  launch: TuiToolLaunch,
): Promise<number> {
  const { runTuiTool: run } = await import('./run-tool.js');
  return run(toolId, launch);
}

/** Pick one of a family's subcommands; resolves with the picked value. */
export async function renderFamilyPicker<T>(
  parentLabel: string,
  options: FamilyPickerOption<T>[],
): Promise<T> {
  const { renderFamilyPicker: render } = await import('./family-picker.js');
  return render(parentLabel, options);
}

/** Launch the TUI primitives playground; resolves 0 once it closes. */
export async function runPlayground(version: string): Promise<number> {
  const { startPlayground } = await import('./playground/start-playground.js');
  return startPlayground(version);
}

/** A TUI store for `programId` with no terminal, as its control target: for walking a flow in tests. */
export async function createTuiTarget(
  programId: ProgramId,
  session: SessionArgs & TuiLaunchChoices,
): Promise<ControlTarget> {
  const { createTuiTarget: create } = await import(
    './control/create-target.js'
  );
  return create(programId, session);
}

/** A program's TUI screen flow, from the TUI program registry: for walking a flow in tests. */
export async function tuiProgramFlow(
  programId: ProgramId,
): Promise<readonly FlowStep[]> {
  const { getFlow } = await import('./programs/index.js');
  return getFlow(programId);
}
