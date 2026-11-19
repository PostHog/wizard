/** Project traits: what detection read from one project's code, in one registry; see the [README](../README.md#project-traits). */

import { DiscoveredFeature } from '@shared/discovered-feature';
import type { MatchKeys } from '@shared/skill-resolution';
import type {
  ProgramSession,
  Project,
  TraitName,
  Traits,
} from '@programs/program-contract';
import { POSTHOG_SDK_SPECS } from '@shared/posthog-sdks';
import { getPostHogSdks } from '../detection/posthog-sdks';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
import { getDetectedWarehouseSources } from '../warehouse-sources/detect';

/** The directory the run works in, the one project detection knows. */
export const RUN_PROJECT = '.';

export type TraitSession = Pick<
  ProgramSession,
  | 'integration'
  | 'frameworkContext'
  | 'discoveredFeatures'
  | 'mcpServerCandidates'
>;

type TraitDefinition<K extends TraitName> = {
  /** The value read from the session; undefined when detection settles nothing. */
  detect: (session: TraitSession) => NonNullable<Traits[K]> | undefined;
  /** Skills can match on it, as a `<trait>:<value>` tag. */
  matchKey?: true;
};

const nonEmpty = <T>(list: readonly T[]): readonly T[] | undefined =>
  list.length > 0 ? list : undefined;

const detectedSdkMajors = (
  session: TraitSession,
  key: keyof typeof POSTHOG_SDK_SPECS,
): readonly string[] | undefined => {
  const majors = new Set<string>();
  for (const entry of getPostHogSdks(session)) {
    if (entry.key === key) majors.add(String(entry.major));
  }
  return nonEmpty([...majors]);
};

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
    matchKey: true,
  },
  callsLlmApi: {
    detect: (session) =>
      session.discoveredFeatures?.includes(DiscoveredFeature.LLM)
        ? 'yes'
        : undefined,
  },
  mcpServers: {
    detect: (session) => nonEmpty(session.mcpServerCandidates ?? []),
  },
  warehouseSources: {
    detect: (session) =>
      nonEmpty(getDetectedWarehouseSources(session).map((s) => s.kind)),
  },
  sdkPython: {
    detect: (session) => detectedSdkMajors(session, 'posthog-python'),
    matchKey: true,
  },
  sdkNode: {
    detect: (session) => detectedSdkMajors(session, 'posthog-node'),
    matchKey: true,
  },
  sdkGo: {
    detect: (session) => detectedSdkMajors(session, 'posthog-go'),
    matchKey: true,
  },
  sdkRust: {
    detect: (session) => detectedSdkMajors(session, 'posthog-rust'),
    matchKey: true,
  },
  sdkIos: {
    detect: (session) => detectedSdkMajors(session, 'posthog-ios'),
    matchKey: true,
  },
  sdkAndroid: {
    detect: (session) => detectedSdkMajors(session, 'posthog-android'),
    matchKey: true,
  },
  sdkFlutter: {
    detect: (session) => detectedSdkMajors(session, 'posthog-flutter'),
    matchKey: true,
  },
};

const TRAIT_NAMES = Object.keys(TRAITS) as TraitName[];

/** The traits of one project. Detection covers the run's own directory; any other path has none yet. */
export function getTraits(
  session: TraitSession,
  projectPath: string = RUN_PROJECT,
): Traits {
  const traits: Traits = {};
  if (projectPath !== RUN_PROJECT) return traits;
  const assign = <K extends TraitName>(name: K): void => {
    const value = TRAITS[name].detect(session);
    if (value !== undefined) traits[name] = value;
  };
  TRAIT_NAMES.forEach(assign);
  return traits;
}

/** The run's project with its traits. */
export function getProject(session: TraitSession): Project {
  return { path: RUN_PROJECT, traits: getTraits(session) };
}

/** The traits skills can match on, as the values per match key. */
export function toMatchKeys(traits: Traits): MatchKeys {
  const keys: Record<string, readonly string[]> = {};
  for (const name of TRAIT_NAMES) {
    const value = traits[name];
    if (value === undefined || !TRAITS[name].matchKey) continue;
    keys[name] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return keys;
}
