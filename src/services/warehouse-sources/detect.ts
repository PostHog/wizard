/**
 * Data warehouse sources and destinations among the tools project discovery
 * found. Pure functions: no store mutations, no UI calls.
 */

import type { ProgramSession } from '@programs/program-contract';
import type { DetectedTool } from '../project-discovery/tools';
import type {
  DetectedDestination,
  DetectedSource,
  SourceDetector,
} from './types';

/**
 * The detected tools a user can import as warehouse sources, minus the ones a
 * more specific match supersedes. Kinds are unique, so the result is deduped.
 */
export function toWarehouseSources(
  tools: readonly DetectedTool[],
  detectors: readonly SourceDetector[],
): DetectedSource[] {
  const kinds = new Set(tools.map((tool) => tool.kind));
  const supersededBy = new Map(
    detectors.map((detector) => [detector.kind, detector.supersededBy ?? []]),
  );
  const sources: DetectedSource[] = [];
  for (const tool of tools) {
    const { mode, warehouseSourceType } = tool;
    // A tool with no setup mode is detected for reporting only, never offered as a source.
    if (mode === null || warehouseSourceType === null) continue;
    if (isSuperseded(supersededBy.get(tool.kind) ?? [], kinds)) continue;
    sources.push({
      kind: warehouseSourceType,
      label: tool.label,
      mode,
      matchedSignal: tool.matchedSignal,
    });
  }
  return sources;
}

/**
 * The detected tools that are warehouses PostHog can export to, one per
 * destination type. A tool's warehouse is found through its detector, so the
 * scan result needs no destination field.
 */
export function toWarehouseDestinations(
  tools: readonly DetectedTool[],
  detectors: readonly SourceDetector[],
): DetectedDestination[] {
  const destinationTypes = new Map(
    detectors.map((detector) => [
      detector.kind,
      detector.warehouseDestinationType,
    ]),
  );
  const seen = new Set<string>();
  const destinations: DetectedDestination[] = [];
  for (const tool of tools) {
    const type = destinationTypes.get(tool.kind);
    if (!type || seen.has(type)) continue;
    seen.add(type);
    destinations.push({
      type,
      label: tool.label,
      matchedSignal: tool.matchedSignal,
    });
  }
  return destinations;
}

/**
 * Whether a more specific match covers this detector's data. Every consumer
 * treats a detected kind as a source to create, so a project whose Postgres
 * lives on Neon or Supabase would otherwise be offered both and end up with
 * the same tables imported twice.
 */
function isSuperseded(
  supersededBy: readonly string[],
  detectedKinds: ReadonlySet<string>,
): boolean {
  return supersededBy.some((other) => detectedKinds.has(other));
}

/** frameworkContext key holding the detected sources (set on success). */
export const DETECTED_WAREHOUSE_SOURCES_KEY = 'detectedWarehouseSources';

/**
 * Read the detected sources out of frameworkContext. Single accessor shared by
 * the intro screen and the prompt builder so the key + cast live in one place.
 */
export function getDetectedWarehouseSources(
  session: ProgramSession,
): DetectedSource[] {
  return (
    (session.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY] as
      | DetectedSource[]
      | undefined) ?? []
  );
}

/** frameworkContext key holding the detected warehouse destinations. */
export const DETECTED_WAREHOUSE_DESTINATIONS_KEY =
  'detectedWarehouseDestinations';

/** Read the detected warehouse destinations out of frameworkContext. */
export function getDetectedWarehouseDestinations(
  session: ProgramSession,
): DetectedDestination[] {
  return (
    (session.frameworkContext[DETECTED_WAREHOUSE_DESTINATIONS_KEY] as
      | DetectedDestination[]
      | undefined) ?? []
  );
}
