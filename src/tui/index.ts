/** The TUI's public runtime entry. Nothing here renders; Ink loads through the loaders. */
export { WizardStore } from './state/store.js';
export { buildSession } from './state/session.js';
export { InkUI } from './state/ink-ui.js';
export { isRunFailure } from './state/mint-failure.js';
export { postAuthGateSteps } from './flows/flow.js';
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
export const loadStartTui = () => import('./app/start-tui.js');
export const loadPlayground = () => import('./playground/start-playground.js');
export const loadFamilyPicker = () => import('./app/family-picker.js');
