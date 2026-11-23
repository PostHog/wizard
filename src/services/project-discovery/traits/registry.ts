/** The trait registry: every trait declared once, with how static detection reads it; see the [README](../../README.md#project-traits). */

import { DiscoveredFeature } from '@shared/discovered-feature';
import type {
  ProgramSession,
  TraitName,
  Traits,
} from '@programs/program-contract';
import { FRAMEWORK_REGISTRY } from '../../frameworks/registry';
import { getDetectedWarehouseSources } from '../../warehouse-sources/detect';

/** The directory the run works in, the one project detection knows. */
export const RUN_PROJECT = '.';

export type TraitDefinition<K extends TraitName> = {
  /** The value read from the session; undefined when detection settles nothing. */
  detect: (session: ProgramSession) => NonNullable<Traits[K]> | undefined;
  /** Skills can match on it, as a `<trait>:<value>` tag. */
  matchKey?: true;
};

const nonEmpty = <T>(list: readonly T[]): readonly T[] | undefined =>
  list.length > 0 ? list : undefined;

/** Every trait, declared once. */
export const TRAITS: { readonly [K in TraitName]: TraitDefinition<K> } = {
  framework: {
    detect: (session) => session.integration ?? undefined,
    matchKey: true,
  },
  frameworkVariant: {
    detect: (session) =>
      session.integration
        ? FRAMEWORK_REGISTRY[session.integration].metadata.getVariant?.(
            session.frameworkContext,
          )
        : undefined,
  },
  callsLlmApi: {
    detect: (session) =>
      session.discoveredFeatures.includes(DiscoveredFeature.LLM)
        ? 'yes'
        : undefined,
  },
  mcpServers: {
    detect: (session) => nonEmpty(session.mcpServerCandidates),
  },
  warehouseSources: {
    detect: (session) =>
      nonEmpty(getDetectedWarehouseSources(session).map((s) => s.kind)),
  },
};

/** Every trait name, in registry order. */
export const TRAIT_NAMES = Object.keys(TRAITS) as TraitName[];
