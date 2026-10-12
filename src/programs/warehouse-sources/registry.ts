/**
 * Registry of data warehouse source detectors, built from PostHog's tool
 * catalog. Edit the catalog in PostHog, not this file or the generated one.
 */

import { TOOL_CATALOG } from './registry.generated.js';
import type { CatalogTool, SourceDetector } from './types.js';

function toDetector(tool: CatalogTool): SourceDetector {
  return {
    kind: tool.kind,
    label: tool.label,
    warehouseSourceType: tool.warehouse_source_type,
    mode: tool.wizard_setup_mode,
    signals: {
      envKeys: tool.signals.env_key_patterns.map(
        (pattern) => new RegExp(pattern),
      ),
      scriptHosts: tool.signals.script_hosts,
      packages: tool.signals.packages,
    },
    supersededBy: tool.superseded_by,
  };
}

export const SOURCE_DETECTORS: SourceDetector[] =
  TOOL_CATALOG.tools.map(toDetector);
