import type { ProgramConfig } from '../program-step';
import type { ProgramRun } from '../program-run';
import { resolveWarehouseSourceRunDefinition } from '../resolve-run-definition';
import { detectWarehousePrerequisites } from './detect.js';
import { getDetectedWarehouseSources } from './detect.js';

export const warehouseSourceConfig: ProgramConfig = {
  command: 'warehouse',
  description: 'Detect and connect Data Warehouse sources',
  id: 'warehouse-source',
  skillId: 'data-warehouse-source-setup',
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

export {
  detectWarehousePrerequisites,
  getDetectedWarehouseSources,
  DETECTED_WAREHOUSE_SOURCES_KEY,
  WAREHOUSE_ABORT_CASES,
  type WarehouseDetectError,
} from './detect.js';
