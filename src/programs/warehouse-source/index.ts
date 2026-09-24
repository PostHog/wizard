import type { ProgramConfig } from '@programs/program-step';
import type { ProgramRun } from '@programs/program-run';
import type { WizardSession } from '@lib/wizard-session';
import {
  resolveWarehouseSourceRunDefinition,
  warehousePrompt,
} from '@programs/resolve-run-definition';
import { WAREHOUSE_SOURCE_PROGRAM } from './steps.js';
import { getDetectedWarehouseSources } from './detect.js';
import { getContentBlocks } from '../../ui/tui/decks/warehouse-source/index.js';

export const warehouseSourceConfig: ProgramConfig = {
  command: 'warehouse',
  description: 'Detect and connect Data Warehouse sources',
  id: 'warehouse-source',
  skillId: 'data-warehouse-source-setup',
  steps: WAREHOUSE_SOURCE_PROGRAM,
  getContentBlocks,
  reportFile: 'posthog-warehouse-report.md',
  allowedTools: ['Agent'],
  run: (session: WizardSession): Promise<ProgramRun> =>
    Promise.resolve({
      ...resolveWarehouseSourceRunDefinition(
        getDetectedWarehouseSources(session),
      ),
      customPrompt: () => warehousePrompt(getDetectedWarehouseSources(session)),
    }),
  requires: ['posthog-integration'],
};

export { WAREHOUSE_SOURCE_PROGRAM } from './steps.js';
export {
  detectWarehousePrerequisites,
  getDetectedWarehouseSources,
  DETECTED_WAREHOUSE_SOURCES_KEY,
  WAREHOUSE_ABORT_CASES,
  type WarehouseDetectError,
} from './detect.js';
