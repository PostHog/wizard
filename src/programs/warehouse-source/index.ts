import type { ProgramConfig } from '@programs/program-step';
import type { ProgramRun } from '@programs/program-run';
import { resolveWarehouseSourceRunDefinition } from '@programs/resolve-run-definition';
import { WAREHOUSE_SOURCE_PROGRAM } from './steps.js';
import { detectWarehousePrerequisites } from './detect.js';
import { getDetectedWarehouseSources } from './detect.js';

export const warehouseSourceConfig: ProgramConfig = {
  command: 'warehouse',
  description: 'Detect and connect Data Warehouse sources',
  id: 'warehouse-source',
  skillId: 'data-warehouse-source-setup',
  steps: WAREHOUSE_SOURCE_PROGRAM,
  onReady: (ctx) =>
    detectWarehousePrerequisites(ctx.session, ctx.setFrameworkContext),
  reportFile: 'posthog-warehouse-report.md',
  allowedTools: ['Agent'],
  run: (
    session: Parameters<typeof getDetectedWarehouseSources>[0],
  ): Promise<ProgramRun> => {
    const run = resolveWarehouseSourceRunDefinition(
      getDetectedWarehouseSources(session),
    );
    return Promise.resolve({
      ...run,
      customPrompt: (ctx) => {
        const latest = resolveWarehouseSourceRunDefinition(
          getDetectedWarehouseSources(session),
        ).customPrompt;
        if (!latest) throw new Error('Warehouse run has no prompt');
        return latest(ctx);
      },
    });
  },
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
