/** The TUI's public runtime entry. Nothing here renders; Ink loads through the loaders. */
export { WizardStore } from './store.js';
export { buildSession } from './session.js';
export { InkUI } from './ink-ui.js';
export { isRunFailure } from './mint-failure.js';
export { postAuthGateSteps } from './flow.js';
export {
  getProgramFlow,
  rawProgramFlow,
  PROGRAM_FLOWS,
} from './flows/index.js';
export { wizardStoreControlTarget } from './control/index.js';
export {
  addMCPServer,
  getInstalledClients,
  getSupportedClients,
  removeMCPServer,
} from './add-mcp-server-to-clients/index.js';
export { ALL_FEATURE_VALUES } from './add-mcp-server-to-clients/defaults.js';
export {
  McpClientStatus,
  namesWithStatus,
} from './add-mcp-server-to-clients/results.js';

/** Ink renders only after one of these loads. */
export const loadStartTui = () => import('./start-tui.js');
export const loadPlayground = () => import('./playground/start-playground.js');
export const loadFamilyPicker = () => import('./family-picker.js');
