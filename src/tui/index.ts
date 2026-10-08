/** The TUI's one entry for other layers; each function loads its module on first call. */
import type { ProgramId } from '@programs';
import type { ProgramConfig } from '@programs/types';
import type { ToolId } from '@tools';
import type { FamilyPickerOption } from './family-picker.js';
import type { FlowStep } from './flow.js';
import type { TuiLaunch, TuiToolLaunch } from './launch.js';
import type { MountedScreens, MountServices } from './harness.js';
import type { WizardStore } from './store.js';
import type { TuiState } from './tui-state.js';

export { Overlay, ScreenId } from './screen-ids.js';
// The programs' and tools' screen ids, from their leaf modules so the entry stays light.
export { AiObservabilityScreenId } from './programs/ai-observability/screen-ids.js';
export { AuditScreenId } from './programs/audit/screen-ids.js';
export { ErrorTrackingScreenId } from './programs/error-tracking/screen-ids.js';
export { SourceMapsScreenId } from './programs/error-tracking-upload-source-maps/screen-ids.js';
export { FeatureFlagsScreenId } from './programs/feature-flags/screen-ids.js';
export { MetricsScreenId } from './programs/metrics/screen-ids.js';
export { MigrationScreenId } from './programs/migration/screen-ids.js';
export { PostHogIntegrationScreenId } from './programs/posthog-integration/screen-ids.js';
export { RevenueAnalyticsScreenId } from './programs/revenue-analytics/screen-ids.js';
export { SelfDrivingScreenId } from './programs/self-driving/screen-ids.js';
export { SkillScreenId } from './programs/shared/screen-ids.js';
export { WarehouseSourceScreenId } from './programs/warehouse-source/screen-ids.js';
export { PosthogDoctorScreenId } from './tools/doctor/screen-ids.js';
export { McpScreenId } from './tools/mcp/screen-ids.js';
export type { FamilyPickerOption } from './family-picker.js';
export type { FlowStep } from './flow.js';
export type { TuiLaunch, TuiToolLaunch } from './launch.js';
export type { McpInstaller } from './services/mcp-installer.js';
export type { WizardStore } from './store.js';
export type { TuiLaunchChoices } from './tui-state.js';
export type { MountedScreens, MountServices } from './harness.js';

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

/** A program's TUI screen flow, from the TUI program registry: for walking a flow in tests. */
export async function tuiProgramFlow(
  programId: ProgramId,
): Promise<readonly FlowStep[]> {
  const { getTuiProgram } = await import('./programs/index.js');
  return getTuiProgram(programId).flow;
}

/** Every screen id the TUI mounts: the core's, the overlays and each program's and tool's own: for checking a table covers them all. */
export async function tuiScreenIds(): Promise<string[]> {
  const { tuiScreenIds: ids } = await import('./harness.js');
  return ids();
}

/** A TUI store for `programId` with no terminal: for walking a flow in tests. */
export async function createTuiStore(
  programId: ProgramId,
): Promise<WizardStore> {
  const { createTuiStore: create } = await import('./harness.js');
  return create(programId);
}

/** The state only the screens use, as `store` holds it now: for asserting what a commit changed. */
export async function readTuiState(store: WizardStore): Promise<TuiState> {
  const { readTuiState: read } = await import('./harness.js');
  return read(store);
}

/** The real screens `store` shows, on a test terminal that takes the keys a test types: for driving screens by keyboard. */
export async function mountScreens(
  store: WizardStore,
  services?: MountServices,
): Promise<MountedScreens> {
  const { mountScreens: mount } = await import('./harness.js');
  return mount(store, services);
}
